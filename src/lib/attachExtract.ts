import { inflateSync, unzipSync } from "fflate";

/**
 * Offline attachment text extraction (PDF + docx), dependency-free beyond
 * the `fflate` copy already vendored for the furigana worker.
 *
 * Both extractors are best-effort and pure: unparseable input yields ""
 * (PDF) or null (docx), never a throw — callers fall back to the
 * unsupported-attachment error. Extracted text is still capped by
 * MAX_FILE_CHARS at the attachment layer.
 */

/** Route a filename/mime to an extractor, or null for plain-text files. */
export type ExtractableFormat = "pdf" | "docx";

export function extractableFormat(
	fileName: string,
	mime: string
): ExtractableFormat | null {
	const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
	if (ext === "pdf" || mime === "application/pdf") return "pdf";
	if (
		ext === "docx" ||
		mime ===
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	) {
		return "docx";
	}
	return null;
}

/**
 * Pull readable text out of raw file bytes for an extractable format.
 * Null when the bytes are not that format (wrong magic / unzip fails).
 */
export function extractAttachmentBytes(
	format: ExtractableFormat,
	bytes: Uint8Array
): string | null {
	try {
		if (format === "pdf") return extractPdfText(bytes);
		return extractDocxText(bytes);
	} catch {
		return null;
	}
}

/** Minimal PDF text pull: literal `(…)` / hex `<…>` strings shown by
 * Tj/TJ operators, across raw and FlateDecode streams. Layout is not
 * preserved — runs join with spaces, TJ arrays with nothing extra —
 * which is all an inlined chat attachment needs. Never throws. */
export function extractPdfText(bytes: Uint8Array): string {
	let raw: string;
	try {
		raw = decodeLatin1(bytes);
	} catch {
		return "";
	}
	if (!raw.startsWith("%PDF")) return "";
	// Raw streams are read separately below, so strip them here —
	// otherwise every stream's text counts twice.
	const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
	const chunks: string[] = [raw.replace(streamRe, "")];
	let match: RegExpExecArray | null;
	while ((match = streamRe.exec(raw)) !== null) {
		const body = match[1] ?? "";
		const dictStart = raw.lastIndexOf("<<", match.index);
		const dict = dictStart === -1 ? "" : raw.slice(dictStart, match.index);
		if (/\/FlateDecode/.test(dict)) {
			const inflated = tryInflate(latin1ToBytes(body));
			if (inflated !== null) chunks.push(inflated);
		} else if (isLikelyTextStream(body)) {
			chunks.push(body);
		}
	}
	const out: string[] = [];
	for (const chunk of chunks) {
		for (const run of stringsInContent(chunk)) out.push(run);
	}
	return out.join(" ").replace(/\s+/g, " ").trim();
}

function decodeLatin1(bytes: Uint8Array): string {
	let out = "";
	const CHUNK = 8192;
	for (let i = 0; i < bytes.length; i += CHUNK) {
		out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return out;
}

function latin1ToBytes(text: string): Uint8Array {
	const out = new Uint8Array(text.length);
	for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
	return out;
}

function tryInflate(bytes: Uint8Array): string | null {
	try {
		return decodeLatin1(inflateSync(bytes));
	} catch {
		return null;
	}
}

/** Raw (undecoded) streams only carry text when they hold PDF operators. */
function isLikelyTextStream(body: string): boolean {
	return /Tj|TJ|\(/.test(body);
}

/** Literal and hex string runs in one content chunk. */
function stringsInContent(chunk: string): string[] {
	const runs: string[] = [];
	// Literal strings: balanced parens with \\, \(, \) escapes and
	// octal codes — a regex cannot nest, so scan by hand.
	for (const literal of scanLiterals(chunk)) {
		const decoded = decodeLiteral(literal);
		if (decoded.trim()) runs.push(decoded);
	}
	// Hex strings: <…>, UTF-16BE when BOM-prefixed.
	const hexRe = /<([0-9a-fA-F\s]+)>/g;
	let m: RegExpExecArray | null;
	while ((m = hexRe.exec(chunk)) !== null) {
		const decoded = decodeHex((m[1] ?? "").replace(/\s+/g, ""));
		if (decoded.trim()) runs.push(decoded);
	}
	return runs;
}

/**
 * Inner bodies of every `(…)` literal in `chunk`, honoring nesting
 * and backslash escapes (`(a(b)c)` is one string, `\\)` is not
 * a closer). Returns bodies without the outer parens.
 */
function scanLiterals(chunk: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let start = -1;
	let escaped = false;
	for (let i = 0; i < chunk.length; i++) {
		const char = chunk[i]!;
		if (start === -1) {
			if (char === "(") {
				start = i;
				depth = 1;
			}
			continue;
		}
		if (escaped) {
			escaped = false;
			continue;
		}
		if (char === "\\") {
			escaped = true;
		} else if (char === "(") {
			depth += 1;
		} else if (char === ")") {
			depth -= 1;
			if (depth === 0) {
				out.push(chunk.slice(start + 1, i));
				start = -1;
			}
		}
	}
	return out;
}

function decodeLiteral(body: string): string {
	return body.replace(
		/\\([nrtbf()\\]|[\r\n]+|[0-7]{1,3})/g,
		(match, code: string) => {
			switch (code) {
				case "n":
					return "\n";
				case "r":
					return "\r";
				case "t":
					return "\t";
				case "b":
					return "\b";
				case "f":
					return "\f";
				case "(":
					return "(";
				case ")":
					return ")";
				case "\\":
					return "\\";
				default:
					// Octal byte (covers \r\n line continuations via the [\r\n]+ arm).
					if (/^[0-7]/.test(code))
						return String.fromCharCode(parseInt(code, 8) & 0xff);
					return match;
			}
		}
	);
}

function decodeHex(hex: string): string {
	if (hex.length === 0 || hex.length % 2 !== 0) return "";
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++)
		bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	// UTF-16BE with BOM (what writers emit for non-Latin text).
	if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
		let out = "";
		for (let i = 2; i + 1 < bytes.length; i += 2) {
			out += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
		}
		return out;
	}
	return decodeLatin1(bytes);
}

/**
 * Docx → text: unzip `word/document.xml`, turn paragraph/tab/line
 * breaks into whitespace, drop all other tags, decode entities.
 * Null when the bytes are not a zip with a document part.
 */
export function extractDocxText(bytes: Uint8Array): string | null {
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(bytes);
	} catch {
		return null;
	}
	const part = files["word/document.xml"];
	if (!part) return null;
	const xml = new TextDecoder().decode(part);
	const withBreaks = xml
		.replace(/<\/w:p[ >][^>]*>|<w:br[^>]*\/>|<w:tab[^>]*\/>/g, "\n")
		.replace(/<[^>]+>/g, "");
	const text = withBreaks
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&")
		.split("\x0b")
		.join("\n")
		.replace(/[ \t\f\r]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return text;
}
