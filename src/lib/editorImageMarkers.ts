/**
 * Attachment-link markers (editor slice).
 *
 * `[Pasted image]` / `[Pasted Attachment]` tags stay literal document
 * text (send-time stripping and tag → attachment reconciliation read
 * the text), but render as underlined links: hovering reveals a preview
 * popup (thumbnail or file excerpt, name, token cost, Copy/OCR
 * actions), clicking does nothing. Decorations recompute from the
 * document on every transaction and remap through edits, so typing
 * beside a tag neither absorbs it nor detaches its file; the Nth tag
 * of a kind always pairs with the Nth attachment of that kind.
 *
 * The editor never sees attachments: callers pass view models plus an
 * optional action callback (the in-place editor renders info-only
 * popups, like it never had OCR).
 */
import {
	EditorState,
	Prec,
	StateField,
	type Extension
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { FILE_MARKER, IMAGE_MARKER } from "./attachments";
import { closestFromTarget } from "./events";

/** Popup data for one marker tag. Built by the host per editor. */
export interface MarkerModel {
	id: string;
	kind: "image" | "text";
	name: string;
	tokens: number;
	/** Downscaled data URL (images with bytes only). */
	dataUrl: string | null;
	/** Leading file text (text kind only). */
	excerpt: string;
	/** OCR running on this attachment (disables its popup button). */
	busy: boolean;
}

export type MarkerAction = "ocr" | "copy";

interface MarkerPlacement {
	from: number;
	to: number;
	label: string;
	kind: "image" | "text";
	index: number;
}

/**
 * Every marker tag in document order with its per-kind index (Nth tag
 * ↔ Nth attachment). Pure and unit-tested.
 */
export function markerPlacements(doc: string): MarkerPlacement[] {
	const out: MarkerPlacement[] = [];
	const seen = { image: 0, text: 0 };
	let cursor = 0;
	for (;;) {
		let at = -1;
		let tag = "";
		for (const candidate of [IMAGE_MARKER, FILE_MARKER]) {
			const found = doc.indexOf(candidate, cursor);
			if (found !== -1 && (at === -1 || found < at)) {
				at = found;
				tag = candidate;
			}
		}
		if (at === -1) return out;
		const kind = tag === IMAGE_MARKER ? "image" : "text";
		out.push({ from: at, to: at + tag.length, label: tag, kind, index: seen[kind]++ });
		cursor = at + tag.length;
	}
}

/** Pair placements with their models (missing model: plain link, no popup). Pure. */
export function placeMarkers(
	doc: string,
	models: MarkerModel[]
): Array<MarkerPlacement & { model: MarkerModel | null }> {
	const byKind = new Map<string, MarkerModel[]>();
	for (const model of models) {
		const list = byKind.get(model.kind) ?? [];
		list.push(model);
		byKind.set(model.kind, list);
	}
	const used = new Map<string, number>();
	return markerPlacements(doc).map((placement) => {
		const list = byKind.get(placement.kind) ?? [];
		const n = used.get(placement.kind) ?? 0;
		used.set(placement.kind, n + 1);
		return { ...placement, model: list[n] ?? null };
	});
}

class AttachmentMarker extends WidgetType {
	constructor(
		readonly label: string,
		readonly model: MarkerModel | null,
		readonly interactive: boolean
	) {
		super();
	}

	eq(other: AttachmentMarker): boolean {
		return (
			other.label === this.label &&
			other.interactive === this.interactive &&
			other.model?.id === this.model?.id &&
			other.model?.name === this.model?.name &&
			other.model?.tokens === this.model?.tokens &&
			other.model?.dataUrl === this.model?.dataUrl &&
			other.model?.excerpt === this.model?.excerpt &&
			other.model?.busy === this.model?.busy
		);
	}

	override ignoreEvent(): boolean {
		return false;
	}

	toDOM(): HTMLElement {
		const link = document.createElement("span");
		link.className = "cm-attach-marker";
		link.textContent = this.label;
		const model = this.model;
		if (!model) return link;
		const popup = document.createElement("span");
		popup.className = "cm-attach-preview";
		popup.setAttribute("aria-hidden", "true");
		if (model.kind === "image" && model.dataUrl) {
			const img = document.createElement("img");
			img.className = "cm-attach-img";
			img.src = model.dataUrl;
			img.alt = "";
			popup.appendChild(img);
		} else if (model.excerpt) {
			const excerpt = document.createElement("span");
			excerpt.className = "cm-attach-excerpt";
			excerpt.textContent = model.excerpt;
			popup.appendChild(excerpt);
		}
		const meta = document.createElement("span");
		meta.className = "cm-attach-meta";
		meta.textContent = `${model.name} · ≈${model.tokens} tokens`;
		popup.appendChild(meta);
		if (this.interactive) {
			const actions = document.createElement("span");
			actions.className = "cm-attach-actions";
			for (const action of ["copy", ...(model.kind === "image" ? ["ocr"] : [])]) {
				const isOcr = action === "ocr";
				const button = document.createElement("button");
				button.type = "button";
				button.className = "cm-attach-btn";
				button.dataset.markerAction = action;
				button.dataset.markerId = model.id;
				button.textContent = isOcr ? (model.busy ? "…" : "OCR") : "Copy";
				button.setAttribute(
					"aria-label",
					isOcr ? "Recognize text in image" : "Copy attachment"
				);
				if (isOcr && model.busy) button.disabled = true;
				actions.appendChild(button);
			}
			popup.appendChild(actions);
		}
		link.appendChild(popup);
		return link;
	}
}

function buildDeco(doc: string, models: MarkerModel[], interactive: boolean): DecorationSet {
	const ranges = placeMarkers(doc, models).map((placement) =>
		Decoration.replace({
			widget: new AttachmentMarker(placement.label, placement.model, interactive)
		}).range(placement.from, placement.to)
	);
	return Decoration.set(ranges);
}

/**
 * Link markers over literal attachment tags, with hover-preview
 * popups. `getModels` reads the host's current attachments (image and
 * text pair by kind order); `onAction` fires popup Copy/OCR clicks.
 * Decorations rebuild on every document change — attachment edits
 * always ride document edits, so the pairing never goes stale.
 */
export function attachmentMarkers(
	getModels: () => MarkerModel[],
	onAction?: (action: MarkerAction, id: string) => void
): Extension {
	const interactive = onAction !== undefined;
	const field = StateField.define<DecorationSet>({
		create: (state: EditorState) => buildDeco(state.doc.toString(), getModels(), interactive),
		update: (_value, tr) => {
			// Rebuild on every transaction (cheap scan; eq() keeps DOM
			// nodes stable), so host-side state like OCR-busy refreshes
			// through an empty poke dispatch, not just doc edits.
			return buildDeco(tr.newDoc.toString(), getModels(), interactive);
		},
		provide: (f) => EditorView.decorations.from(f, (value) => value)
	});
	// Same guard as the paste markers: the OCR/Copy click must not move
	// the caret first (mousedown would steal it); link clicks otherwise
	// behave like text (caret lands, nothing fires).
	const clicks = Prec.high(
		EditorView.domEventHandlers({
			mousedown: (event) => {
				if (closestFromTarget(event.target, "[data-marker-action]")) {
					event.preventDefault();
					return true;
				}
				return false;
			},
			click: (event) => {
				const button = closestFromTarget(event.target, "[data-marker-action]");
				if (!button || !onAction) return false;
				const action = button.getAttribute("data-marker-action");
				const id = button.getAttribute("data-marker-id") ?? "";
				if ((action === "ocr" || action === "copy") && id) onAction(action, id);
				return true;
			}
		})
	);
	return [field, clicks];
}
