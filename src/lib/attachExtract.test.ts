import { describe, it, expect } from "vitest";
import { deflateSync, zipSync } from "fflate";
import {
	extractableFormat,
	extractAttachmentBytes,
	extractDocxText,
	extractPdfText
} from "./attachExtract";

const enc = new TextEncoder();

function pdfWithStream(streamBody: string, dict = "<< /Length 0 >>"): string {
	return `%PDF-1.4\n1 0 obj\n${dict}\nstream\n${streamBody}\nendstream\nendobj\n`;
}

describe("extractableFormat", () => {
	it("routes pdf and docx by extension or mime", () => {
		expect(extractableFormat("a.pdf", "")).toBe("pdf");
		expect(extractableFormat("a", "application/pdf")).toBe("pdf");
		expect(extractableFormat("a.docx", "")).toBe("docx");
		expect(
			extractableFormat(
				"a",
				"application/vnd.openxmlformats-officedocument.wordprocessingml.document"
			)
		).toBe("docx");
		expect(extractableFormat("a.txt", "text/plain")).toBe(null);
		expect(extractableFormat("photo.png", "image/png")).toBe(null);
	});
});

describe("extractPdfText", () => {
	it("reads literal Tj strings", () => {
		const pdf = pdfWithStream("BT /F1 12 Tf (Hello world) Tj ET");
		expect(extractPdfText(enc.encode(pdf))).toBe("Hello world");
	});

	it("unescapes literal-string escapes", () => {
		const pdf = pdfWithStream("BT ((a) b\\\\c) Tj ET");
		expect(extractPdfText(enc.encode(pdf))).toBe("(a) b\\c");
	});

	it("reads hex strings including UTF-16BE with BOM", () => {
		const pdf = pdfWithStream("BT <FEFF4E2D6587> Tj ET");
		expect(extractPdfText(enc.encode(pdf))).toBe("中文");
	});

	it("inflates FlateDecode streams", () => {
		const compressed = deflateSync(enc.encode("BT (Flated text) Tj ET"));
		// Latin1-safe assembly: TextEncoder would mangle raw deflate
		// bytes as UTF-8, so splice the byte ranges by hand.
		const head = enc.encode(
			`%PDF-1.4\n1 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`
		);
		const tail = enc.encode("\nendstream\nendobj\n");
		const pdf = new Uint8Array(head.length + compressed.length + tail.length);
		pdf.set(head, 0);
		pdf.set(compressed, head.length);
		pdf.set(tail, head.length + compressed.length);
		expect(extractPdfText(pdf)).toBe("Flated text");
	});

	it("returns empty for non-PDF bytes and never throws", () => {
		expect(extractPdfText(enc.encode("not a pdf"))).toBe("");
		expect(extractPdfText(new Uint8Array(0))).toBe("");
	});
});

function docxWith(paragraphs: string): Uint8Array {
	const xml =
		`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
		paragraphs +
		`</w:body></w:document>`;
	return zipSync({ "word/document.xml": enc.encode(xml) });
}

const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

describe("extractDocxText", () => {
	it("joins paragraphs with newlines and decodes entities", () => {
		const bytes = docxWith(para("Hello &amp; goodbye") + para("Second line"));
		expect(extractDocxText(bytes)).toBe("Hello & goodbye\nSecond line");
	});

	it("returns null for non-zip bytes", () => {
		expect(extractDocxText(enc.encode("hello"))).toBe(null);
		expect(extractDocxText(zipSync({ "other.txt": enc.encode("hi") }))).toBe(
			null
		);
	});
});

describe("fileToAttachment with extracted formats", () => {
	it("inlines PDF text as a text attachment", async () => {
		const { fileToAttachment } = await import("./attachments");
		const pdf = pdfWithStream("BT (Lesson vocabulary) Tj ET");
		const file = new File([enc.encode(pdf)], "lesson.pdf", {
			type: "application/pdf"
		});
		const attachment = await fileToAttachment(file);
		expect(attachment.kind).toBe("text");
		expect(attachment.text).toBe("Lesson vocabulary");
		expect(attachment.tokens).toBeGreaterThan(0);
	});

	it("rejects empty PDFs like any other unsupported file", async () => {
		const { fileToAttachment } = await import("./attachments");
		const file = new File([enc.encode("not a pdf")], "empty.pdf", {
			type: "application/pdf"
		});
		await expect(fileToAttachment(file)).rejects.toThrow(
			"Unsupported attachment"
		);
	});
});

describe("extractAttachmentBytes", () => {
	it("never throws on garbage", () => {
		expect(extractAttachmentBytes("pdf", enc.encode("garbage"))).toBe("");
		expect(extractAttachmentBytes("docx", enc.encode("garbage"))).toBe(null);
	});
});
