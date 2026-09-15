import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

const ASSISTANT = `The energy levels:

$$E_n = -\\frac{13.6\\text{ eV}}{n^2}$$

where \\(n = 1, 2, \\dots\\) counts the level.

Not math, just a price: $$totally broken \\sqrt{.

\`\`\`tex
$$E = mc^2$$
\`\`\``;

test.beforeEach(async ({ page }) => {
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	await seedChat(page, [
		{ role: "user", content: "show me the levels" },
		{ role: "assistant", content: ASSISTANT }
	]);
	await page.goto("/");
	await expect(page.locator(".ccez-math").first()).toBeVisible({ timeout: 60_000 });
});

/** Display math renders KaTeX with copy + `$` chrome and a hidden folded label. */
test("display block carries copy, $ toggle, and folded label", async ({ page }) => {
	const block = page.locator(".ccez-math").first();
	await expect(block.locator(".ccez-math-body")).toBeVisible();
	expect(await block.locator(".katex").count()).toBeGreaterThan(0);
	await expect(block.locator(".ccez-math-copy")).toBeVisible();
	await expect(block.locator(".ccez-math-tex")).toBeVisible();
	await expect(block.locator(".ccez-math-foldedlabel")).toBeHidden();
	await expect(block.locator(".ccez-math-raw")).toBeHidden();
});

/** Body click never copies: only the copy icon writes the clipboard. */
test("body click selects without copying", async ({ page }) => {
	await page.evaluate(() => navigator.clipboard.writeText("SENTINEL"));
	const block = page.locator(".ccez-math").first();
	await block.locator(".ccez-math-body").click();
	await page.waitForTimeout(500);
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("SENTINEL");
	await expect(page.locator(".toast")).toHaveCount(0);
	// The body is an I-beam surface: a drag selects equation text.
	const body = block.locator(".ccez-math-body");
	const box = await body.boundingBox();
	if (!box) throw new Error("math body has no box");
	await page.mouse.move(box.x + 8, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width - 8, box.y + box.height / 2, { steps: 5 });
	await page.mouse.up();
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).not.toBe("");
});

/** Inline math renders bare with no chrome at all. */
test("inline math renders with no chrome", async ({ page }) => {
	const inline = page.locator(".ccez-math-inline").first();
	await expect(inline).toBeVisible();
	await expect(inline.locator(".ccez-math-head")).toHaveCount(0);
	await expect(inline.locator("button")).toHaveCount(0);
	expect(await inline.locator(".katex").count()).toBeGreaterThan(0);
});

/** Single-dollar inline math renders with KaTeX; prices stay plain text. */
test("single-dollar inline math renders, prices stay plain", async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: "quadratic?" },
		{ role: "assistant", content: "Roots are $x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$ but it costs $5 and $10." }
	]);
	await page.goto("/");
	const inline = page.locator(".ccez-math-inline").first();
	await expect(inline).toBeVisible({ timeout: 60_000 });
	expect(await inline.locator(".katex").count()).toBeGreaterThan(0);
	await expect(page.locator(".ccez-math-inline")).toHaveCount(1);
	await expect(page.locator(".rendered").last()).toContainText("$5 and $10");
});

/** Invalid math and fenced $$ stay plain text, never fatal. */
test("invalid math and code fences stay plain", async ({ page }) => {
	const body = page.locator(".rendered").last();
	await expect(body).toContainText("totally broken");
	await expect(body).toContainText("E = mc^2");
	// One display block + one inline span; the broken $$ and the fence add none.
	await expect(page.locator(".ccez-math")).toHaveCount(1);
	await expect(page.locator(".ccez-math-inline")).toHaveCount(1);
});

/** The composer prompt never renders math: typed $$ stays plain text. */
test("composer does not render latex", async ({ page }) => {
	const composer = page.locator(".cm-content").first();
	await composer.click();
	await page.keyboard.type("$$x^2$$");
	await expect(composer.locator(".ccez-math")).toHaveCount(0);
	await expect(composer.locator(".ccez-math-inline")).toHaveCount(0);
});

/** Right-clicking the math block toggles the fold and never starts audio: zero speaking classes and the live highlight keeps. */
test("right-click toggles the math fold, left-click unfolds, and both stay silent", async ({
	page
}) => {
	const para = page.locator("article .rendered p").first();
	const box = await para.boundingBox();
	if (!box) throw new Error("paragraph has no box");
	const y = box.y + box.height / 2;
	await page.mouse.move(box.x + 10, y);
	await page.mouse.down();
	await page.mouse.move(box.x + 120, y, { steps: 5 });
	await page.mouse.up();
	const block = page.locator(".ccez-math").first();
	const body = block.locator(".ccez-math-body");
	await expect(body).toBeVisible();
	await body.click({ button: "right" });
	await expect(block).toHaveAttribute("data-folded", "1");
	await expect(body).toBeHidden();
	await expect(block.locator(".ccez-math-foldedlabel")).toBeVisible();
	await expect(block.locator(".ccez-math-foldedlabel")).toHaveText("latex · 1 LOC");
	await page.waitForTimeout(500);
	await expect(page.locator("article.speaking, article.speaking-sel")).toHaveCount(0);
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).not.toBe("");
	// A second right-click toggles back open (shortcuts modal: "Right-click toggles").
	await block.click({ button: "right" });
	await expect(block).not.toHaveAttribute("data-folded", "1");
	await expect(body).toBeVisible();
	// Fold once more so the left-click unfold below starts folded.
	await body.click({ button: "right" });
	await expect(block).toHaveAttribute("data-folded", "1");
	// Left-click on the folded label unfolds.
	await block.locator(".ccez-math-foldedlabel").click();
	await expect(block).not.toHaveAttribute("data-folded", "1");
	await expect(body).toBeVisible();
});

/** A latex fence duplicating its neighboring display block renders exactly once. */
test("fence-plus-display pair shows once", async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: "quad" },
		{ role: "assistant", content: "Quad:\n\n```latex\n$$x = 1$$\n```\n\n$$x = 1$$" }
	]);
	await page.goto("/");
	const blocks = page.locator("article.assistant .ccez-math");
	await expect(blocks).toHaveCount(1, { timeout: 60_000 });
	await expect(page.locator("article.assistant .ccez-code")).toHaveCount(0);
	await expect(blocks.first().locator(".ccez-math-body")).toBeVisible();
});

/** A lone latex fence renders as display math (not a code block). */
test("lone latex fence renders as math", async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: "quad" },
		{ role: "assistant", content: "Quad:\n\n```latex\nx = 1\n```" }
	]);
	await page.goto("/");
	const blocks = page.locator("article.assistant .ccez-math");
	await expect(blocks).toHaveCount(1, { timeout: 60_000 });
	await expect(page.locator("article.assistant .ccez-code")).toHaveCount(0);
	expect(await blocks.first().locator(".katex").count()).toBeGreaterThan(0);
});

/** The `$` toggle flips the rendered equation and its raw source. */
test("$ toggle shows raw source and back", async ({ page }) => {
	const block = page.locator(".ccez-math").first();
	const raw = block.locator(".ccez-math-raw");
	await expect(raw).toBeHidden();
	await block.locator(".ccez-math-tex").click();
	await expect(raw).toBeVisible();
	await expect(raw).toContainText("E_n");
	await expect(block.locator(".ccez-math-body")).toBeHidden();
	await block.locator(".ccez-math-tex").click();
	await expect(raw).toBeHidden();
	await expect(block.locator(".ccez-math-body")).toBeVisible();
});

/** The math copy button copies the TeX with delimiters plus a toast. */
test("math copy button copies tex", async ({ page }) => {
	const block = page.locator(".ccez-math").first();
	await block.locator(".ccez-math-copy").click();
	await expect(page.locator(".toast")).toHaveText("Copied", { timeout: 10_000 });
	const clip = await page.evaluate(() => navigator.clipboard.readText());
	expect(clip).toContain("E_n");
	expect(clip.trim().startsWith("$$")).toBe(true);
	expect(clip.trim().endsWith("$$")).toBe(true);
});

/** Folded math shrinks to its label: no dead space right of the LOC. */
test("folded math hugs its label", async ({ page }) => {
	const block = page.locator(".ccez-math").first();
	await block.locator(".ccez-math-body").click({ button: "right" });
	await expect(block).toHaveAttribute("data-folded", "1");
	const widths = await block.evaluate((el) => {
		const label = el.querySelector(".ccez-math-foldedlabel") as HTMLElement;
		return { block: el.getBoundingClientRect().width, label: label.getBoundingClientRect().width };
	});
	expect(widths.block).toBeLessThan(widths.label + 8);
});

/** Equation granularity decision: a partial pick inside one equation
snaps to the whole equation (a glyph shard never re-matches, so the
entry point expands the range before quoting). Stale-highlight and
double-highlight rendering stay with the annotation/render lanes. */
test("partial equation pick snaps to the whole equation", async ({ page }) => {
	const body = page.locator(".ccez-math-body").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("math body has no box");
	const y = box.y + box.height / 2;
	// A short drag covering only the left part of the equation.
	await page.mouse.move(box.x + 8, y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.4, y, { steps: 5 });
	await page.mouse.up();
	const full = await body.evaluate((el) => el.textContent ?? "");
	expect(full.trim().length).toBeGreaterThan(0);
	// KaTeX splits glyphs across layout spans, so raw strings differ
	// in whitespace — compare whitespace-stripped: the snap must have
	// expanded the partial drag over the whole body.
	const flat = (s: string) => s.replace(/\s+/g, "");
	await expect
		.poll(
			() => page.evaluate(() => window.getSelection()?.toString() ?? "").then((s) => flat(s)),
			{ timeout: 8000 }
		)
		.toBe(flat(full));
});

/** Triple-clicking raw TeX drops the paragraph terminator: the highlight
stops at the equation instead of painting the line beneath. */
test("triple-click raw tex stops at the equation", async ({ page }) => {
	const block = page.locator(".ccez-math").first();
	await block.locator(".ccez-math-tex").click();
	const raw = block.locator(".ccez-math-raw");
	await expect(raw).toBeVisible();
	const box = await raw.boundingBox();
	if (!box) throw new Error("raw tex has no box");
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { clickCount: 3 });
	// Range (not Selection) text: Selection.toString synthesizes block
	// breaks, so it always trails one here — the range itself must stop
	// at the equation, which is what paints the highlight.
	const sel = await page.evaluate(() => {
		const live = window.getSelection();
		return live && live.rangeCount > 0 ? live.getRangeAt(0).toString() : "";
	});
	expect(sel).toContain("E_n");
	expect(sel.endsWith("\n")).toBe(false);
	await expect(page.locator(".sel-menu")).toBeVisible();
});

/** Double-clicking the end of raw TeX drops the word pick's trailing
newline: the highlight stops at the equation instead of painting the
line beneath. */
test("double-click raw tex stops at the equation", async ({ page }) => {
	const block = page.locator(".ccez-math").first();
	await block.locator(".ccez-math-tex").click();
	const raw = block.locator(".ccez-math-raw");
	await expect(raw).toBeVisible();
	const box = await raw.boundingBox();
	if (!box) throw new Error("raw tex has no box");
	await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2, { clickCount: 2 });
	// Range (not Selection) text: Selection.toString synthesizes block
	// breaks, so it always trails one here — the range itself must stop
	// at the equation, which is what paints the highlight.
	const sel = await page.evaluate(() => {
		const live = window.getSelection();
		return live && live.rangeCount > 0 ? live.getRangeAt(0).toString() : "";
	});
	expect(sel.endsWith("\n")).toBe(false);
	await expect(page.locator(".sel-menu")).toBeVisible();
});

/** Folded labels are chrome, not content: the label text itself never
quotes (no `latex · N LOC` annotations) — a drag across it may catch
neighboring content, but the block stays folded and clicks unfold. */
test("folded label text never quotes", async ({ page }) => {
	const block = page.locator(".ccez-math").first();
	await block.locator(".ccez-math-body").click({ button: "right" });
	await expect(block).toHaveAttribute("data-folded", "1");
	const label = block.locator(".ccez-math-foldedlabel");
	const box = await label.boundingBox();
	if (!box) throw new Error("folded label has no box");
	await page.mouse.move(box.x + 4, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2, { steps: 5 });
	await page.mouse.up();
	await page.waitForTimeout(500);
	expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).not.toContain("latex");
	await expect(block).toHaveAttribute("data-folded", "1");
});

/** Hovering another chat previews its equations with settled chrome:
no entrance animation runs over the copy button or its ancestors,
and its box never moves. Both chats carry the same equation, so any
delta across the hover is pure chrome motion, never content. */
test("preview settles latex chrome", async ({ page }) => {
	await page.addInitScript(() => {
		const msg = (id: string, content: string) => ({ id, role: "assistant", content, usage: null, error: null });
		const eq = "$$\\sum_{i=0}^{n} \\frac{x_i^2}{\\sqrt{1 + x_i^2}}$$";
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{ id: "chat-a", createdAt: 1, replyLang: null, messages: [msg("a-m", `Alpha.\n\n${eq}\n\ntail.`)] },
				{ id: "chat-b", createdAt: 2, replyLang: null, messages: [msg("b-m", `Beta.\n\n${eq}\n\ntail.`)] }
			])
		);
	});
	await page.goto("/");
	await expect(page.locator(".ccez-math-copy").first()).toBeVisible({ timeout: 60_000 });
	// KaTeX webfonts shift equation widths (and the centered chrome
	// with them) while loading: settle first so any delta across the
	// hover is chrome motion, never a font swap.
	await page.evaluate(() => document.fonts.ready);
	await page.keyboard.press("Meta+b");
	await expect(page.locator("aside").first()).not.toHaveClass(/collapsed/);
	// Trace the chrome box at 60fps across the hover instant.
	const tracePromise = page.evaluate(
		() =>
			new Promise((resolve: (samples: { x: number; y: number; chain: string[] }[]) => void) => {
				const out: { x: number; y: number; chain: string[] }[] = [];
				let n = 0;
				const tick = (): void => {
					const target = document.querySelector("main .ccez-math-copy");
					if (target) {
						const rect = target.getBoundingClientRect();
						const chain: string[] = [];
						let el: Element | null = target;
						while (el && el !== document.body) {
							for (const anim of document.getAnimations({ subtree: true })) {
								const effectTarget = (anim.effect as KeyframeEffect | null)?.target ?? null;
								if (effectTarget === el && anim instanceof CSSAnimation) chain.push(anim.animationName);
							}
							el = el.parentElement;
						}
						out.push({ x: rect.x, y: rect.y, chain });
					}
					if (++n < 40) requestAnimationFrame(tick);
					else resolve(out);
				};
				requestAnimationFrame(tick);
			})
	);
	await page.waitForTimeout(100);
	await page.locator("aside ul li button.side-chat").nth(1).hover();
	const trace = await tracePromise;
	expect(trace.length).toBeGreaterThan(10);
	// The preview mounts settled bodies: the aid-swap entrance fade
	// stays off, so nothing animates over the chrome...
	expect(trace.flatMap((sample) => sample.chain)).toEqual([]);
	// ...and with identical equations the box sits perfectly still.
	for (const sample of trace) {
		expect(sample.x).toBe(trace[0]?.x ?? 0);
		expect(sample.y).toBe(trace[0]?.y ?? 0);
	}
});
