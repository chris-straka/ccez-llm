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
 * Sent-message image literals: one `[Pasted image]` per image
 * attachment, appended in attachment order so the render pairs them
 * back (Nth of a kind to Nth of a kind). The tag rides the text flow
 * — part of the message, never a separate block — while the stored
 * attachments still carry the bytes. Pure and unit-tested.
 */
export function appendImageMarkers(text: string, imageCount: number): string {
	if (imageCount <= 0) return text;
	const tags = Array.from({ length: imageCount }, () => IMAGE_MARKER).join(" ");
	return text === "" ? tags : `${text} ${tags}`;
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
 * Fresh-line prefix for a marker tag: empty and newline-ended drafts
 * take the tag as-is, a tag chained right after another tag's trailing
 * space stays on that line (repeat pastes ride one line), and mid-prose
 * starts a fresh line so typed text never glues onto the tag. Pure and
 * unit-tested.
 */
function markerPrefix(doc: string, afterPaste = false): string {
	if (doc === "" || doc.endsWith("\n")) return "";
	if (doc.endsWith(`${IMAGE_MARKER} `) || doc.endsWith(`${FILE_MARKER} `)) return "";
	// Right after a collapsed paste: the tag rides the same line, one
	// space apart (never a newline of its own).
	if (afterPaste) return doc.endsWith(" ") ? "" : " ";
	return "\n";
}

/**
 * Composer insertion for a newly pasted/dropped image: the tag stays on
 * the current line with one trailing space, the caret landing right
 * after it — the user types beside the tag, never below it. Consumers
 * match the tag text itself (never the whole line), so typing beside it
 * neither absorbs it nor detaches the pill. Pure and unit-tested.
 */
export function imageMarkerInsert(doc: string, afterPaste = false): string {
	return `${markerPrefix(doc, afterPaste)}${IMAGE_MARKER} `;
}

/**
 * Composer insertion for a newly attached file: same contract as the
 * image tag (same line, one trailing space, caret after it).
 */
export function fileMarkerInsert(doc: string, afterPaste = false): string {
	return `${markerPrefix(doc, afterPaste)}${FILE_MARKER} `;
}

/**
 * Compact token count for pill chrome (`~1.1k`, `~2.3M`): full digits
 * wrap the pill footer onto a second line past four figures, so counts
 * stay short while exact figures live in the title attribute. Pure and
 * unit-tested.
 */
export function formatTokenCount(tokens: number): string {
	if (tokens < 1000) return `~${tokens}`;
	if (tokens < 1_000_000) return `~${trimCompact(tokens / 1000)}k`;
	return `~${trimCompact(tokens / 1_000_000)}M`;
}

/** One decimal, trimmed (`1.0` → `1`): the compact count's fraction. */
function trimCompact(value: number): string {
	const rounded = Math.round(value * 10) / 10;
	return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * How many tags of one kind a draft holds (tag → attachment
 * reconciliation counts images and files separately). Pure.
 */
/**
 * Blobs for the `count` newest image attachments (composer tag
 * copy/cut supplier): the same end the tag→pill reconciliation drops,
 * so what leaves the tray is what lands on the clipboard. Unreadable
 * entries are skipped, never fatal.
 */
export async function attachmentImageBlobs(
	list: Attachment[],
	count: number
): Promise<Blob[]> {
	if (count <= 0) return [];
	const imgs = list.filter((att) => att.kind === "image" && att.dataUrl).slice(-count);
	return fetchAttachmentBlobs(imgs);
}

/** Shared fetch: unreadable entries skipped, never fatal. */
async function fetchAttachmentBlobs(picks: Attachment[]): Promise<Blob[]> {
	const settled = await Promise.allSettled(
		picks.map((att) => fetch(att.dataUrl as string).then((res) => res.blob()))
	);
	return settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
}

/**
 * Blobs for the image attachments at these document-order indexes
 * (Nth image tag pairs with the Nth image attachment — the composer
 * contract). Indexing rides kind order, not read success: entries
 * without bytes are skipped in place, so survivors keep tag order.
 * Pure apart from fetch.
 */
export async function attachmentImageBlobsAt(
	list: Attachment[],
	indexes: number[]
): Promise<Blob[]> {
	const imgs = list.filter((att) => att.kind === "image");
	const picks: Attachment[] = [];
	for (const i of indexes) {
		const att = imgs[i];
		if (att !== undefined && att.dataUrl !== null) picks.push(att);
	}
	return fetchAttachmentBlobs(picks);
}

/**
 * Data URLs for the image attachments at these document-order
 * indexes, read synchronously for same-event clipboard setData.
 * Null entries (no bytes) are skipped downstream. Pure.
 */
export function attachmentDataUrlsAt(list: Attachment[], indexes: number[]): (string | null)[] {
	const imgs = list.filter((att) => att.kind === "image");
	return indexes.map((i) => imgs[i]?.dataUrl ?? null);
}

/**
 * Drop the attachments of one kind at these document-order indexes
 * (tag deletions carry their positions now, not just counts).
 * Out-of-range and negative indexes drop nothing. Pure.
 */
export function dropAttachmentsAtIndexes(
	list: Attachment[],
	kind: AttachmentKind,
	indexes: number[]
): Attachment[] {
	const drop = new Set(indexes.filter((i) => i >= 0));
	let seen = -1;
	return list.filter((att) => {
		if (att.kind !== kind) return true;
		seen++;
		return !drop.has(seen);
	});
}

/**
 * Clipboard-safe PNG for an image blob: Chromium's clipboard.write
 * rejects anything but image/png ("Type image/jpeg not supported on
 * write"), while attachments store JPEG data URLs. Falls back to the
 * original blob when conversion is unavailable (Safari writes JPEG).
 */
/**
 * Data URL for a blob (clipboard image-set JSON). FileReader needs a
 * browser; unit tests never call this (e2e covers the round trip).
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
		reader.onerror = () => reject(reader.error ?? new Error("blob read failed"));
		reader.readAsDataURL(blob);
	});
}

export async function clipboardPngBlob(blob: Blob): Promise<Blob> {
	if (blob.type === "image/png") return blob;
	let bitmap: ImageBitmap | null = null;
	try {
		bitmap = await createImageBitmap(blob);
		const canvas = document.createElement("canvas");
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const ctx = canvas.getContext("2d");
		if (!ctx) return blob;
		ctx.drawImage(bitmap, 0, 0);
		const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
		return png ?? blob;
	} catch {
		return blob;
	} finally {
		bitmap?.close();
	}
}

/**
 * Tag-count reconciliation (pure, unit-tested): how many newest
 * attachments of a kind to drop when the draft holds `tags` markers
 * for `atts` attachments after previously holding `prev` markers.
 * Falls drop the difference; orphans (attachments with no tags, from
 * undo and cross-editor flows) drop the excess. Tags are the expressed
 * intent: never deleted silently here, never resurrected.
 */
export function reconcileDropCount(atts: number, tags: number, prev: number): number {
	return Math.max(0, prev - tags, atts - tags);
}

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
	return removeMarkerAt(text, marker, 0);
}

/**
 * Remove the index-th global occurrence of a marker tag (a pill drops
 * its own tag now, not the first of its kind): same line surgery as
 * the first-occurrence path, anchored at that occurrence's span. The
 * occurrence takes one following space with it when present; a host
 * line left blank drops with its newline. Out-of-range indexes leave
 * the text untouched. Pure and unit-tested.
 */
export function removeMarkerAt(
	text: string,
	marker: string = IMAGE_MARKER,
	index: number = 0
): string {
	if (index < 0) return text;
	const lines = text.split("\n");
	let seen = -1;
	let at = -1;
	let tagAt = -1;
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i] ?? "";
		let from = 0;
		for (;;) {
			const found = raw.indexOf(marker, from);
			if (found < 0) break;
			seen++;
			if (seen === index) {
				at = i;
				tagAt = found;
				break;
			}
			from = found + marker.length;
		}
		if (at >= 0) break;
	}
	if (at < 0) return text;
	const raw = lines[at] ?? "";
	const after = raw.slice(tagAt + marker.length);
	const cutEnd = tagAt + marker.length + (after.startsWith(" ") ? 1 : 0);
	const noTag = (raw.slice(0, tagAt) + raw.slice(cutEnd)).trimEnd();
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

/** History tag popup action (delegated in MessageBody — raw `{@html}`
 * markup carries no Svelte handlers). */
export type SentTagAction = "copy" | "ocr";

/** Preview data for one sent-message tag: the expanded card names
 * the file and its token cost, so the model carries those plus bytes,
 * text, and its fold-open state. Callers pair by kind order. */
export interface AttachTagModel {
	id: string;
	kind: AttachmentKind;
	/** Original file name, shown in the expanded card. */
	name: string;
	/** Estimated tokens, shown in the expanded card. */
	tokens: number;
	/** True while the tag is expanded in place (fold-open). */
	open: boolean;
	/** Downscaled data URL (images with bytes only). */
	dataUrl: string | null;
	/** Full file text (text kind only; the builder excerpts it). */
	text: string | null;
}
