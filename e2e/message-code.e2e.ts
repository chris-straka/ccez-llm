import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

const ASSISTANT = `<think>Let me think about what hello.py needs.</think>

Here is the file \`hello.py\` you asked for:

\`\`\`python
def hi():
    print("hi")
\`\`\`

Run it with \`python hello.py\`.`;

test.beforeEach(async ({ page }) => {
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	await seedChat(page, [
		{ role: "user", content: "give me python" },
		{ role: "assistant", content: ASSISTANT }
	]);
	await page.goto("/");
	await expect(page.locator(".ccez-code").first()).toBeVisible({ timeout: 60_000 });
	// Shiki enhancement is async: wait for highlighted spans.
	await expect(page.locator(".ccez-code .shiki span").first()).toBeVisible({ timeout: 20_000 });
});

/** AI fenced code renders highlighted, and short blocks hug the code. */
test("assistant python block is highlighted and narrow", async ({ page }) => {
	expect(await page.locator(".ccez-code .shiki span").count()).toBeGreaterThan(0);
	const sizes = await page.evaluate(() => {
		const block = document.querySelector(".ccez-code") as HTMLElement;
		return { block: block.offsetWidth, column: block.parentElement?.offsetWidth ?? 0 };
	});
	expect(sizes.column).toBeGreaterThan(0);
	expect(sizes.block).toBeLessThan(sizes.column);
});

/** Dark theme keeps filenames and code text readable (never white-on-white). */
test("dark code stays contrasted", async ({ page }) => {
	await page.emulateMedia({ colorScheme: "dark" });
	await page.reload();
	await expect(page.locator(".ccez-code .shiki span").first()).toBeVisible({ timeout: 20_000 });
	const ratio = await page.evaluate(() => {
		const lum = (rgb: string): number => {
			const [r, g, b] = rgb
				.replace(/[^\d,]/g, "")
				.split(",")
				.map(Number) as [number, number, number];
			const f = (c: number): number => {
				const s = (c ?? 0) / 255;
				return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
			};
			return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
		};
		const contrast = (fg: string, bg: string): number => {
			const [a, z] = [lum(fg), lum(bg)].sort((x, y) => y - x) as [number, number];
			return (a + 0.05) / (z + 0.05);
		};
		const cs = (el: Element, p: string): string => getComputedStyle(el as HTMLElement).getPropertyValue(p);
		const inline = document.querySelector(".rendered :not(pre) > code") as HTMLElement;
		const pre = document.querySelector(".ccez-code pre") as HTMLElement;
		// Token spans carry the Shiki colors (the code element itself
		// merely inherits body text, so measuring it passes while
		// tokens stay dark-on-dark — the actual dark-theme bug).
		const tokens = Array.from(document.querySelectorAll(".ccez-code .shiki span")) as HTMLElement[];
		const preBg = cs(pre, "background-color");
		const worst = Math.min(...tokens.map((t) => contrast(cs(t, "color"), preBg)));
		return {
			theme: document.documentElement.getAttribute("data-theme"),
			inline: contrast(cs(inline, "color"), cs(inline, "background-color")),
			tokens: tokens.length,
			worstToken: worst
		};
	});
	expect(ratio.theme).toBe("dark");
	expect(ratio.inline).toBeGreaterThanOrEqual(4.5);
	expect(ratio.tokens).toBeGreaterThan(0);
	expect(ratio.worstToken).toBeGreaterThanOrEqual(4.5);
});

/** AI code blocks carry a copy icon button plus a folded label, and no fold bar. */
test("assistant code block has a copy button with no fold bar", async ({ page }) => {
	const block = page.locator(".ccez-code").first();
	await expect(block.locator(".ccez-code-head")).toHaveCount(0);
	await expect(block.locator("button.ccez-code-copy")).toHaveCount(1);
	await expect(block.locator("button.ccez-code-copy")).toHaveAttribute(
		"aria-label",
		"Copy code block"
	);
	await expect(block.locator(".ccez-code-foldedlabel")).toContainText("python");
});

/** Body clicks select natively and never copy: no toast, clipboard untouched. */
test("code body click selects without copying", async ({ page }) => {
	await page.evaluate(() => navigator.clipboard.writeText("SENTINEL"));
	const block = page.locator(".ccez-code").first();
	await block.locator("pre").click();
	await page.waitForTimeout(500);
	await expect(page.locator(".toast", { hasText: "Copied" })).toHaveCount(0);
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("SENTINEL");
	const pre = block.locator("pre");
	const box = await pre.boundingBox();
	if (!box) throw new Error("code pre has no box");
	await page.mouse.move(box.x + 8, box.y + 8);
	await page.mouse.down();
	// To near the pre's right edge (inside the icon gutter, past the
	// text): selects the full last line whatever the gutter width.
	await page.mouse.move(box.x + box.width - 8, box.y + box.height - 8, { steps: 5 });
	await page.mouse.up();
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).toContain('print("hi")');
	await expect(page.locator(".toast", { hasText: "Copied" })).toHaveCount(0);
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("SENTINEL");
});

/** Right-click toggles the fold, left-click on the folded label unfolds, and neither starts audio. */
test("right-click toggles the code fold, left-click unfolds, staying silent", async ({ page }) => {
	const block = page.locator(".ccez-code").first();
	const pre = block.locator("pre");
	await expect(pre).toBeVisible();
	await pre.click({ button: "right" });
	await expect(block).toHaveAttribute("data-folded", "1");
	await expect(pre).toBeHidden();
	await page.waitForTimeout(500);
	await expect(page.locator("article.speaking, article.speaking-sel")).toHaveCount(0);
	// A second right-click toggles back open (shortcuts modal: "Right-click toggles").
	await block.click({ button: "right" });
	await expect(block).not.toHaveAttribute("data-folded", "1");
	await expect(pre).toBeVisible();
	// Fold once more so the left-click unfold below starts folded.
	await pre.click({ button: "right" });
	await expect(block).toHaveAttribute("data-folded", "1");
	await expect(pre).toBeHidden();
	// Left-click on the folded label unfolds.
	await block.locator(".ccez-code-foldedlabel").click();
	await expect(block).not.toHaveAttribute("data-folded", "1");
	await expect(pre).toBeVisible();
});

/** Folded code shrinks to its label: no dead space right of the LOC. */
test("folded code hugs its label", async ({ page }) => {
	const block = page.locator(".ccez-code").first();
	await block.locator("pre").click({ button: "right" });
	await expect(block).toHaveAttribute("data-folded", "1");
	const widths = await block.evaluate((el) => {
		const label = el.querySelector(".ccez-code-foldedlabel") as HTMLElement;
		return { block: el.getBoundingClientRect().width, label: label.getBoundingClientRect().width };
	});
	// Label width plus border, not the 12rem unfolded floor.
	expect(widths.block).toBeLessThan(widths.label + 8);
});
