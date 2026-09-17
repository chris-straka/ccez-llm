// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { aidTextNodes, AID_SKIP_SELECTOR } from "./aidNodes";

function rootOf(html: string): Element {
	const host = document.createElement("div");
	host.innerHTML = html;
	return host;
}

describe("aidTextNodes", () => {
	it("collects prose text, skipping blanks", () => {
		const nodes = aidTextNodes(rootOf("<p>Hello <strong>世界</strong></p><p>  </p>"));
		expect(nodes.map((n) => n.textContent)).toEqual(["Hello ", "世界"]);
	});

	it("skips code, math, chrome, ruby, and controls", () => {
		const nodes = aidTextNodes(
			rootOf(
				"<p>keep 读取</p>" +
					"<pre><code>code 读取</code></pre>" +
					'<div class="ccez-math" data-math-index="0"><div class="ccez-math-body">E 读取</div>' +
					'<pre class="ccez-math-raw">raw 读取</pre></div>' +
					'<p>ruby <ruby>読<rt>よみ</rt></ruby> tail</p>' +
					'<p><button>btn 读取</button> <a href="#">link 读取</a></p>' +
					'<div class="ccez-code-output">out 读取</div>'
			)
		);
		expect(nodes.map((n) => n.textContent)).toEqual(["keep 读取", "ruby ", " tail"]);
	});

	it("stays empty with no prose", () => {
		expect(aidTextNodes(rootOf("<pre>x</pre>"))).toEqual([]);
		expect(aidTextNodes(rootOf(""))).toEqual([]);
	});

	it("documents the skip contract", () => {
		for (const sel of ["pre", "code", "[data-math-index]", ".katex", "ruby", "rt", "rp", "button", "a"]) {
			expect(AID_SKIP_SELECTOR).toContain(sel);
		}
	});
});
