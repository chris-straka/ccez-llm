/**
 * Draft annotation storage: per-chat localStorage load/save with
 * shape validation. Split out of annotations.ts (section C).
 */
import type { Annotation, StoryAnchor } from "./annotations";

/**
 * Draft annotations persist per chat across restarts (live extras, not
 * the baked blocks — sending bakes pins while filed notes survive).
 * Shape-checked on the way back in: corrupt entries drop, valid ones
 * restore; quotes that no longer match simply list without a badge,
 * never an error.
 */
const DRAFT_KEY = "ccez-llm-annotations-v1";
/** Pre-rename key (ccez-studio era): read once, then saves move to DRAFT_KEY. */
const LEGACY_DRAFT_KEY = "ccez-studio-annotations-v1";

function validStoryAnchor(raw: unknown): StoryAnchor | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const s = raw as Partial<StoryAnchor>;
	if (typeof s.link !== "string" || !s.link) return undefined;
	if (
		typeof s.title !== "string" ||
		typeof s.outlet !== "string" ||
		typeof s.lang !== "string"
	)
		return undefined;
	return { link: s.link, title: s.title, outlet: s.outlet, lang: s.lang };
}

function cleanDraftList(raw: unknown): Annotation[] {
	if (!Array.isArray(raw)) return [];
	const out: Annotation[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") continue;
		const a = item as Partial<Annotation>;
		if (typeof a.id !== "string") continue;
		const messageId = typeof a.messageId === "string" ? a.messageId : undefined;
		const story = validStoryAnchor(a.story);
		if (!messageId && !story) continue;
		if (typeof a.quote !== "string" || typeof a.comment !== "string") continue;
		out.push({
			id: a.id,
			...(messageId ? { messageId } : {}),
			...(story ? { story } : {}),
			quote: a.quote,
			comment: a.comment,
			at: typeof a.at === "number" ? a.at : 0,
			// Answers persist with drafts like the comment: a reload
			// must not un-ask an answered annotation back to blue.
			// Pins never persist (fresh loads start unpinned, so a
			// stale approval can't ride a later send); deleting is
			// the only removal.
			...(typeof a.answer === "string" && a.answer
				? { answer: a.answer }
				: {})
		});
	}
	return out;
}

export function loadDraftAnnotations(chatId: string): Annotation[] {
	try {
		if (typeof localStorage === "undefined") return [];
		const raw =
			localStorage.getItem(DRAFT_KEY) ?? localStorage.getItem(LEGACY_DRAFT_KEY);
		if (!raw) return [];
		const record = JSON.parse(raw) as Record<string, unknown>;
		return cleanDraftList(record?.[chatId]);
	} catch {
		return [];
	}
}

export function saveDraftAnnotations(
	chatId: string,
	list: Annotation[],
	knownIds: string[]
): void {
	try {
		if (typeof localStorage === "undefined") return;
		let record: Record<string, unknown> = {};
		try {
			record =
				(JSON.parse(
					localStorage.getItem(DRAFT_KEY) ??
						localStorage.getItem(LEGACY_DRAFT_KEY) ??
						"{}"
				) as Record<string, unknown>) ?? {};
		} catch {
			record = {};
		}
		if (list.length === 0) delete record[chatId];
		else record[chatId] = list;
		for (const key of Object.keys(record))
			if (!knownIds.includes(key)) delete record[key];
		localStorage.setItem(DRAFT_KEY, JSON.stringify(record));
	} catch {
		// Storage full or blocked: drafts stay memory-only.
	}
}
