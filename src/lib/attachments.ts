import { extractAttachmentBytes, extractableFormat } from "./attachExtract";
import { estimateTextTokens } from "./render";

/**
 * Composer attachments: images (downscaled client-side before send) and
 * text files (inlined with a token estimate). Every attachment carries its
 * own estimate so the composer can show cost before sending.
 */

export type AttachmentKind = "image" | "text";

export interface Attachment {
	id: string;
	name: string;
	mime: string;
	kind: AttachmentKind;
	/** Downscaled data URL (images only). */
	dataUrl: string | null;
	/** File text (text kind only). */
	text: string | null;
	width: number | null;
	height: number | null;
	/** Estimated tokens this attachment adds to the request. */
	tokens: number;
}

/** Marker line inserted in the prompt when an image is pasted. The composer
 * strips these lines on send — the image travels as an attachment instead. */
export const IMAGE_MARKER = "[Pasted image]";

/** Max side (px) for images before upload. */
export const IMAGE_MAX_DIM = 1568;

/**
 * OpenAI-style vision estimate: a base cost plus per-512px-tile cost on the
 * downscaled image.
 */
export function imageTokens(width: number, height: number): number {
	const tiles = Math.ceil(width / 512) * Math.ceil(height / 512);
	return 85 + 170 * Math.max(1, tiles);
}

/** Target dimensions fitting inside IMAGE_MAX_DIM, preserving aspect ratio. */
export function fitDimensions(width: number, height: number): { width: number; height: number } {
	const scale = Math.min(1, IMAGE_MAX_DIM / Math.max(width, height));
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale))
	};
}

/** Downscale an image to a data URL via canvas. Callers pass a loaded
 * HTMLImageElement (or any canvas-drawImage source with width/height). */
export function downscaleImage(
	source: { width: number; height: number },
	draw: (canvas: HTMLCanvasElement, width: number, height: number) => void,
	mime = "image/jpeg"
): Promise<{ dataUrl: string; width: number; height: number }> {
	const { width, height } = fitDimensions(source.width, source.height);
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	draw(canvas, width, height);
	// Promise interface (not async): canvas work is synchronous, but every
	// caller already awaits this, so the signature stays put.
	return Promise.resolve({
		dataUrl: canvas.toDataURL(mime, 0.85),
		width,
		height
	});
}

export function newId(): string {
	return crypto.randomUUID();
}

/** Shared constructor for inlined-text attachments (plain, PDF, docx). */
function textAttachment(name: string, mime: string, text: string): Attachment {
	return {
		id: newId(),
		name,
		mime,
		kind: "text",
		dataUrl: null,
		text,
		width: null,
		height: null,
		tokens: estimateTextTokens(text)
	};
}

const TEXT_MIMES = [
	"text/",
	"application/json",
	"application/javascript",
	"application/typescript",
	"application/x-sh",
	"application/yaml",
	"application/toml",
	"application/xml"
];

const TEXT_EXTENSIONS = [
	"txt", "md", "markdown", "json", "js", "ts", "tsx", "jsx", "mjs", "cjs",
	"py", "rb", "go", "rs", "java", "c", "h", "cpp", "hpp", "cs", "swift",
	"kt", "php", "sh", "bash", "zsh", "yaml", "yml", "toml", "xml", "html",
	"css", "scss", "sql", "csv", "tsv", "log", "ini", "cfg", "conf", "env",
	"dockerfile", "gitignore", "svelte", "vue", "rs"
];

/** Cap inlined file text so one attachment can't blow the context window. */
export const MAX_FILE_CHARS = 100_000;

export function isTextFile(file: File): boolean {
	if (TEXT_MIMES.some((m) => file.type.startsWith(m))) return true;
	const ext = file.name.split(".").pop()?.toLowerCase();
	return !!ext && TEXT_EXTENSIONS.includes(ext);
}

/** Read a user file into an Attachment (images downscaled, text inlined). */
export async function fileToAttachment(file: File): Promise<Attachment> {
	if (file.type.startsWith("image/")) {
		const bitmap = await createImageBitmap(file);
		try {
			const { width, height } = fitDimensions(bitmap.width, bitmap.height);
			const canvas = document.createElement("canvas");
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext("2d");
			if (!ctx) throw new Error("Canvas 2D unavailable");
			ctx.drawImage(bitmap, 0, 0, width, height);
			return {
				id: newId(),
				name: file.name || "pasted-image",
				mime: "image/jpeg",
				kind: "image",
				dataUrl: canvas.toDataURL("image/jpeg", 0.85),
				text: null,
				width,
				height,
				tokens: imageTokens(width, height)
			};
		} finally {
			bitmap.close();
		}
	}
	if (isTextFile(file)) {
		const raw = await file.text();
		const text = raw.length > MAX_FILE_CHARS ? raw.slice(0, MAX_FILE_CHARS) : raw;
		return textAttachment(file.name || "pasted-text", file.type || "text/plain", text);
	}
	// PDF/docx carry no usable `File.text()`: pull the text out of the
	// raw bytes offline (no downloads, no server) and inline it like
	// any other text file. Images are already handled above.
	const format = extractableFormat(file.name, file.type);
	if (format) {
		const bytes = new Uint8Array(await file.arrayBuffer());
		const raw = extractAttachmentBytes(format, bytes)?.trim() ?? "";
		if (raw) {
			const text = raw.length > MAX_FILE_CHARS ? raw.slice(0, MAX_FILE_CHARS) : raw;
			return textAttachment(file.name || `pasted-${format}`, file.type || format, text);
		}
	}
	throw new Error(`Unsupported attachment: ${file.name || file.type || "unknown file"}`);
}

/**
 * Drop pasted-image marker tags; the images travel as attachments.
 * Every occurrence goes (tag plus one following space), so tags typed
 * beside prose strip cleanly at send; a host line left blank by the
 * removal drops, while the user's own blank lines stay put.
 */
export function stripImageMarkers(text: string): string {
	return text
		.split("\n")
		.flatMap((line) => {
			if (!line.includes(IMAGE_MARKER)) return [line];
			let out = line;
			while (out.includes(IMAGE_MARKER)) {
				out = out.includes(`${IMAGE_MARKER} `)
					? out.replace(`${IMAGE_MARKER} `, "")
					: out.replace(IMAGE_MARKER, "");
			}
			return out.trim() === "" ? [] : [out];
		})
		.join("\n");
}

/**
 * Composer insertion for a newly pasted/dropped image: the tag stays on
 * the current line with one trailing space, the caret landing right
 * after it — the user types beside the tag, never below it. Consumers
 * match the tag text itself (never the whole line), so typing beside it
 * neither absorbs it nor detaches the pill. Never a leading blank
 * line: the prefix newline only starts the tag mid-draft. Pure and
 * unit-tested.
 */
export function imageMarkerInsert(doc: string): string {
	const prefix = doc === "" || doc.endsWith("\n") ? "" : "\n";
	return `${prefix}${IMAGE_MARKER} `;
}

/**
 * Remove one marker tag (pill → tag half of two-way removal): the first
 * occurrence goes with one adjacent space; a host line left blank by
 * the removal drops, so bare tags vanish exactly as before — while
 * prose typed beside the tag survives. Pure and unit-tested.
 */
export function removeMarker(text: string): string {
	const lines = text.split("\n");
	const at = lines.findIndex((line) => line.includes(IMAGE_MARKER));
	if (at === -1) return text;
	const raw = lines[at] ?? "";
	const noTag = (
		raw.includes(`${IMAGE_MARKER} `) ? raw.replace(`${IMAGE_MARKER} `, "") : raw.replace(IMAGE_MARKER, "")
	).trimEnd();
	const next = [...lines.slice(0, at), ...lines.slice(at + 1)];
	if (noTag.trim() !== "") next.splice(at, 0, noTag);
	return next.join("\n");
}

/** How many marker tags a draft holds (tag → pill reconciliation). */
export function countMarkers(text: string): number {
	return text.split(IMAGE_MARKER).length - 1;
}
