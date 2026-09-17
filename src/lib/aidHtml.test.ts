// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { aidHtml, aidPinyinHtml, convertAidNode } from "./aidHtml";

describe("convertAidNode", () => {
	it("rubies Han text in pinyin mode, escapes the rest", async () => {
		const converted = await convertAidNode("中文 test", "pinyin", null);
		expect(converted).toContain("<ruby>");
		expect(converted).toContain("test");
	});

	it("leaves non-pinyin nodes bare", async () => {
		await expect(convertAidNode("hello world", "pinyin", null)).resolves.toBeNull();
		// Kana is Japanese: pinyin never annotates it.
		await expect(convertAidNode("ひらがな", "pinyin", null)).resolves.toBeNull();
		await expect(convertAidNode("hello", "dual", null)).resolves.toBeNull();
	});
});

describe("aidPinyinHtml", () => {
	it("rubies prose but keeps code and math blocks intact", () => {
		const html = aidPinyinHtml(
			"<p>中文段落</p>" +
				'<pre><code>print("中文")\n</code></pre>' +
				'<div class="ccez-math" data-math-index="0"><div class="ccez-math-body">' +
				'<span class="katex">E = mc^2 中文</span></div></div>',
			null
		);
		expect(html).toContain("<ruby>");
		// Code and math carry no ruby and keep their structure.
		expect(html).toContain('<pre><code>print("中文")');
		expect(html).toContain("ccez-math-body");
		expect(html.match(/<ruby>/g)?.length).toBeGreaterThan(0);
		const mathPart = html.slice(html.indexOf("ccez-math"));
		expect(mathPart).not.toContain("<ruby>");
	});

	it("leaves formatting elements in place", () => {
		const html = aidPinyinHtml("<p>看<strong>中文</strong>书</p>", null);
		expect(html).toContain("<strong>");
		expect(html).toContain("<ruby>");
	});

	it("passes aid-free HTML through unchanged", () => {
		const clean = "<p>hello world</p>";
		expect(aidPinyinHtml(clean, null)).toBe(clean);
	});
});

describe("aidHtml", () => {
	it("dual mode rubies Han prose and skips the rest", async () => {
		const html = await aidHtml("<p>中文 and English</p><pre><code>x = 1</code></pre>", "dual", null);
		expect(html).toContain("<ruby>");
		expect(html).toContain("<pre><code>x = 1</code></pre>");
	});
});
