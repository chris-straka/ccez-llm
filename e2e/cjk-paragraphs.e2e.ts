import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

const PARA =
	"秋が近づくと、空が高くなり、紅葉が美しく色づきます。温かいお茶を飲みながら、ゆっくりと読書をしたり散歩を楽しんだりするのにぴったりの季節です。";

/** Three Japanese paragraphs read as three: the tall ruby-reserving
line-height must not swallow the breaks, so CJK paragraphs carry a
fuller margin plus the standard 1em first-line indent. */
test("cjk paragraphs break visibly", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: `${PARA}\n\n${PARA}\n\n${PARA}` }]);
	await page.goto("/");
	const body = page.locator("article .rendered").first();
	await expect(body).toBeVisible({ timeout: 60_000 });
	const info = await page.evaluate(() => {
		const ps = [...document.querySelectorAll("article .rendered p.cjk")];
		return ps.map((p) => {
			const el = p as HTMLElement;
			const cs = getComputedStyle(el);
			const r = el.getBoundingClientRect();
			return { indent: cs.textIndent, marginTop: cs.marginTop, top: r.top, bottom: r.bottom };
		});
	});
	expect(info).toHaveLength(3);
	for (const p of info) {
		expect(p.indent, "first-line indent").not.toBe("0px");
		expect(p.marginTop, "paragraph margin").not.toBe("0px");
	}
	// Real gaps between the blocks, not just wrapped lines.
	expect(info[1].top - info[0].bottom).toBeGreaterThan(0);
	expect(info[2].top - info[1].bottom).toBeGreaterThan(0);
	// Every paragraph fills the column: pretty rebalancing once left
	// different paragraphs ending at visibly different right edges.
	const rights = await page.evaluate(() => {
		const ps = [...document.querySelectorAll("article .rendered p.cjk")];
		return ps.map((p) => {
			const range = document.createRange();
			range.selectNodeContents(p);
			const rects = range.getClientRects();
			return Math.max(...[...rects].map((r) => r.right));
		});
	});
	expect(rights).toHaveLength(3);
	expect(Math.max(...rights) - Math.min(...rights)).toBeLessThanOrEqual(8);
	// ...but no trailing gap before the action row.
	const lastMargin = await page.evaluate(() => {
		const ps = [...document.querySelectorAll("article .rendered p.cjk")];
		const last = ps[ps.length - 1] as HTMLElement;
		return getComputedStyle(last).marginBottom;
	});
	expect(lastMargin).toBe("0px");
});

/** Latched tall leading: CJK starts tight, jumps once when readings
land (masked by the ruby appearing), then stays tall when the toggle
goes back off — no oscillation. Needs the real worker, so it lives
with the e2e (90s budget for first-run dictionary build). */
test("numbered-list items latch tall across the furigana toggle", async ({ page }) => {
	test.setTimeout(90_000);
	await seedChat(page, [
		{ role: "assistant", content: "3. 漢字を読むテスト\n4. 空が高くなる" }
	]);
	await page.goto("/");
	await expect(page.locator("article.assistant li").first()).toBeVisible({ timeout: 60_000 });
	const geom = () =>
		page.evaluate(() => {
			const lis = [...document.querySelectorAll("article.assistant li")];
			return lis.map((li) => {
				const el = li as HTMLElement;
				const r = el.getBoundingClientRect();
				return { top: r.top, lh: getComputedStyle(el).lineHeight };
			});
		});
	const toggle = page.locator('article.assistant .actions button:has-text("読み仮名")');
	const ruby = page.locator("article.assistant .rendered .frb");
	// Tight before anything renders: the tall reservation is latched,
	// not reserved up front.
	const before = await geom();
	await toggle.click();
	await expect(ruby.first()).toBeVisible({ timeout: 60_000 });
	const on = await geom();
	expect(on).toHaveLength(before.length);
	// The one allowed jump: readings landed, leading went tall.
	expect(parseFloat(on[0]!.lh)).toBeGreaterThan(parseFloat(before[0]!.lh));
	// Toggling back off removes the ruby but keeps the tall leading —
	// tops match the ON geometry, not the before one. (Once pinned,
	// the row button becomes the show-original toggle.)
	await page.locator('article.assistant .actions button:has-text("オリジナル")').click();
	await expect(ruby).toHaveCount(0, { timeout: 60_000 });
	const off = await geom();
	expect(off).toHaveLength(on.length);
	for (let i = 0; i < on.length; i++) {
		expect(Math.abs(off[i]!.top - on[i]!.top)).toBeLessThanOrEqual(1);
		expect(off[i]!.lh).toBe(on[i]!.lh);
	}
});
