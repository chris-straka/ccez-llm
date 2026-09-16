import { extractAttachmentBytes, extractableFormat } from "./attachExtract";

/** Rough token estimate for plain text (~4 chars per token). */
export function estimateTextTokens(text: string): number {
	return Math.max(1, Math.ceil(text.length / 4));
}

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

/** Marker tag inserted in the prompt when an image is pasted. The composer
 * strips these tags on send — the image travels as an attachment instead. */
export const IMAGE_MARKER = "[Pasted image]";
/** Marker tag for attached files (text, PDF, …): same contract as images. */
export const FILE_MARKER = "[Pasted Attachment]";

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

/** Every attachment tag (they never overlap, so scan order only reads). */
const ATTACHMENT_TAGS = [IMAGE_MARKER, FILE_MARKER];

/** Earliest tag occurrence at or after `from`, or null. Pure. */
function nextTag(line: string, from: number): { at: number; tag: string } | null {
	let found: { at: number; tag: string } | null = null;
	for (const tag of ATTACHMENT_TAGS) {
		const at = line.indexOf(tag, from);
		if (at !== -1 && (found === null || at < found.at)) found = { at, tag };
	}
	return found;
}

/**
 * Remove every attachment tag from one line (tag plus one following
 * space), with line-relative cut ranges for send-time fold mapping.
 * Shared by the send strip and the fold math so the two can't drift.
 * Pure and unit-tested.
 */
export function removeTags(line: string): {
	text: string;
	cuts: Array<{ start: number; end: number }>;
} {
	let out = "";
	const cuts: Array<{ start: number; end: number }> = [];
	let cursor = 0;
	let hit = nextTag(line, cursor);
	while (hit !== null) {
		out += line.slice(cursor, hit.at);
		const end = hit.at + hit.tag.length + (line[hit.at + hit.tag.length] === " " ? 1 : 0);
		cuts.push({ start: hit.at, end });
		cursor = end;
		hit = nextTag(line, cursor);
	}
	out += line.slice(cursor);
	return { text: out, cuts };
}

/**
 * Drop attachment marker tags; the files travel as attachments. A host
 * line left blank by the removal drops, while the user's own blank
 * lines stay put.
 */
export function stripAttachmentMarkers(text: string): string {
	return text
		.split("\n")
		.flatMap((line) => {
			if (!line.includes(IMAGE_MARKER) && !line.includes(FILE_MARKER)) return [line];
			const { text: out } = removeTags(line);
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
 * Composer insertion for a newly attached file: same contract as the
 * image tag (same line, one trailing space, caret after it).
 */
export function fileMarkerInsert(doc: string): string {
	const prefix = doc === "" || doc.endsWith("\n") ? "" : "\n";
	return `${prefix}${FILE_MARKER} `;
}

/**
 * How many tags of one kind a draft holds (tag → attachment
 * reconciliation counts images and files separately). Pure.
 */
export function countMarkers(text: string, marker: string = IMAGE_MARKER): number {
	return text.split(marker).length - 1;
}

/**
 * Remove one marker tag (pill → tag half of two-way removal, still live
 * on Android where pills survive): the first occurrence goes with one
 * following space; a host line left blank by the removal drops, so bare
 * tags vanish — while prose typed beside the tag survives. Pure and
 * unit-tested.
 */
export function removeMarker(text: string, marker: string = IMAGE_MARKER): string {
	const lines = text.split("\n");
	const at = lines.findIndex((line) => line.includes(marker));
	if (at === -1) return text;
	const raw = lines[at] ?? "";
	const tagged = `${marker} `;
	const noTag = (raw.includes(tagged) ? raw.replace(tagged, "") : raw.replace(marker, "")).trimEnd();
	const next = [...lines.slice(0, at), ...lines.slice(at + 1)];
	if (noTag.trim() !== "") next.splice(at, 0, noTag);
	return next.join("\n");
}

/**
 * Leading file text for a marker popup: first lines up to the cap,
 * cut mid-line with an ellipsis. Pure and unit-tested.
 */
export function fileExcerpt(text: string, maxChars = 240): string {
	const excerpt = text.slice(0, maxChars);
	return text.length > maxChars ? `${excerpt.trimEnd()}…` : excerpt;
}

// --- Sent-message tags: literals rebuilt as preview links ---

const TAG_OPEN = "\uE002";
const TAG_CLOSE = "\uE003";

/** One marker literal in document order. `index` is the per-kind order
 * (Nth tag of a kind pairs with the Nth attachment of that kind — the
 * same contract the composer markers use). */
export interface ExtractedTag {
	kind: AttachmentKind;
	index: number;
}

/** Placeholder for one extracted tag: kind letter plus per-kind index. */
export function tagPlaceholder(kind: AttachmentKind, index: number): string {
	return `${TAG_OPEN}${kind === "image" ? "i" : "f"}${index}${TAG_CLOSE}`;
}

/** Placeholders back to tags: kind letter plus per-kind index. */
export const ATTACH_TAG_RE = /\uE002([if])(\d+)\uE003/g;

/**
 * Pull attachment-tag literals out of message markdown, skipping ```
 * fenced blocks and backtick code spans (discussing a tag is not
 * attaching one — same skipping the math extractor uses). Pure and
 * unit-tested. Returns the source with placeholders plus the tags in
 * document order.
 */
export function extractAttachmentTags(markdownText: string): {
	stripped: string;
	tags: ExtractedTag[];
} {
	const tags: ExtractedTag[] = [];
	const seen = { image: 0, text: 0 };
	let out = "";
	let i = 0;
	const len = markdownText.length;
	const lineStart = (pos: number): boolean => pos === 0 || markdownText[pos - 1] === "\n";
	while (i < len) {
		// Fenced code block: skip whole lines from opener to closer (or EOF).
		if (lineStart(i) && markdownText.startsWith("```", i)) {
			const openEnd = markdownText.indexOf("\n", i);
			const bodyStart = openEnd === -1 ? len : openEnd + 1;
			let close = bodyStart;
			let closeEnd = -1;
			while (close < len) {
				const nl = markdownText.indexOf("\n", close);
				const lineEnd = nl === -1 ? len : nl;
				const line = markdownText.slice(close, lineEnd);
				if (/^\s*```\s*$/.test(line)) {
					closeEnd = nl === -1 ? len : nl + 1;
					break;
				}
				close = lineEnd + 1;
			}
			const end = closeEnd === -1 ? len : closeEnd;
			out += markdownText.slice(i, end);
			i = end;
			continue;
		}
		const ch = markdownText[i];
		// Inline code span: skip to the matching run on the same line.
		if (ch === "`") {
			let run = 1;
			while (markdownText[i + run] === "`") run++;
			const nl = markdownText.indexOf("\n", i);
			const lineEnd = nl === -1 ? len : nl;
			const ticks = "`".repeat(run);
			const close = markdownText.indexOf(ticks, i + run);
			if (close !== -1 && close < lineEnd) {
				out += markdownText.slice(i, close + run);
				i = close + run;
				continue;
			}
			out += markdownText.slice(i, i + run);
			i += run;
			continue;
		}
		// Marker literal outside code: placeholder, paired later by kind order.
		let kind: AttachmentKind | null = null;
		if (markdownText.startsWith(IMAGE_MARKER, i)) kind = "image";
		else if (markdownText.startsWith(FILE_MARKER, i)) kind = "text";
		if (kind !== null) {
			const index = seen[kind]++;
			tags.push({ kind, index });
			out += tagPlaceholder(kind, index);
			i += kind === "image" ? IMAGE_MARKER.length : FILE_MARKER.length;
			continue;
		}
		out += ch ?? "";
		i++;
	}
	return { stripped: out, tags };
}

/**
 * Attachments with no literal left in the message text (send strips
 * tags, so fresh turns pair nothing): the first N attachments of each
 * kind are consumed by the N literals of that kind, the rest render
 * in the tag strip above the message. Pure and unit-tested.
 */
export function leftoverAttachments(attachments: Attachment[], text: string): Attachment[] {
	const { tags } = extractAttachmentTags(text);
	const literals = { image: 0, text: 0 };
	for (const tag of tags) literals[tag.kind]++;
	const seen = { image: 0, text: 0 };
	return attachments.filter((att) => {
		if (seen[att.kind] < literals[att.kind]) {
			seen[att.kind]++;
			return false;
		}
		return true;
	});
}

/** Popup data for one sent-message tag. Callers pair by kind order. */
export interface AttachTagModel {
	id: string;
	kind: AttachmentKind;
	name: string;
	tokens: number;
	/** Downscaled data URL (images with bytes only). */
	dataUrl: string | null;
	/** Full file text (text kind only; the builder excerpts it). */
	text: string | null;
}
