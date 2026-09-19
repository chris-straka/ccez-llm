import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

const ASSISTANT = `Here is a script:

\`\`\`python
print("hi")
\`\`\`

And one nobody can run:

\`\`\`haskell
main = return ()
\`\`\``;

test.beforeEach(async ({ page }) => {
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	await seedChat(page, [
		{ role: "user", content: "give me code" },
		{ role: "assistant", content: ASSISTANT }
	]);
	await page.goto("/");
	await expect(page.locator(".ccez-code").first()).toBeVisible({
		timeout: 60_000
	});
});

/** Runnable fences carry Run next to copy; unrunnable ones (prose,
output samples, unknown labels) get copy alone — never a button
that only explains itself. */
test("only runnable blocks have a Run button", async ({ page }) => {
	const blocks = page.locator(".ccez-code");
	await expect(blocks).toHaveCount(2);
	const run = blocks.first().locator("button.ccez-code-run");
	await expect(run).toHaveCount(1);
	await expect(run).toHaveAttribute("aria-label", "Run code block");
	await expect(blocks.nth(1).locator("button.ccez-code-run")).toHaveCount(0);
	await expect(blocks.nth(1).locator("button.ccez-code-copy")).toHaveCount(1);
});

/** The Run control is a play icon, never the word "Run". */
test("Run button is a play icon, not text", async ({ page }) => {
	const run = page
		.locator(".ccez-code")
		.first()
		.locator("button.ccez-code-run");
	await expect(run).toHaveText("");
	await expect(run.locator("svg")).toHaveCount(1);
});

/** Browser preview has no shell: Run stamps the disabled reason, never a throw. */
test("Run without a backend shows the disabled note", async ({ page }) => {
	const block = page.locator(".ccez-code").first();
	await block.locator("button.ccez-code-run").click();
	const output = block.locator(".ccez-code-output");
	await expect(output).toBeVisible({ timeout: 10_000 });
	await expect(output).toContainText("desktop app");
});

/** Unrunnable fences offer no Run control and stamp no tray. */
test("unrunnable blocks have no Run control or tray", async ({ page }) => {
	const block = page.locator(".ccez-code").nth(1);
	await expect(block.locator("button.ccez-code-run")).toHaveCount(0);
	await expect(block.locator(".ccez-code-output")).toHaveCount(0);
});

/** Run never folds the block, never copies, and stays silent. */
test("Run leaves fold, clipboard, and toasts alone", async ({ page }) => {
	await page.evaluate(() => navigator.clipboard.writeText("SENTINEL"));
	const block = page.locator(".ccez-code").first();
	await block.locator("button.ccez-code-run").click();
	await expect(block.locator(".ccez-code-output")).toBeVisible({
		timeout: 10_000
	});
	await expect(block).not.toHaveAttribute("data-folded", "1");
	await expect(block.locator("pre")).toBeVisible();
	await expect(page.locator(".toast", { hasText: "Copied" })).toHaveCount(0);
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
		"SENTINEL"
	);
});

/** Clicking code selects normally: no in-place editing, no contenteditable. */
test("code clicks select normally and never edit", async ({ page }) => {
	const block = page.locator(".ccez-code").first();
	await block.locator("pre").click();
	await expect(block).not.toHaveClass(/is-editing/);
	expect(await page.locator(".ccez-code code[contenteditable]").count()).toBe(
		0
	);
	const code = block.locator("code").first();
	const box = await code.boundingBox();
	if (!box) throw new Error("code has no box");
	await page.mouse.dblclick(box.x + 20, box.y + box.height / 2);
	const selected = await page.evaluate(
		() => window.getSelection()?.toString() ?? ""
	);
	expect(selected).not.toBe("");
	await expect(block).not.toHaveClass(/is-editing/);
});

/** Always-hide: clicking code never summons the hidden prompt. */
test("code clicks never summon the hidden prompt", async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: "give me code" },
		{
			role: "assistant",
			content: 'Run it:\n\n```python\nprint("hi")\n```\n\n' + "x".repeat(2000)
		}
	]);
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ promptIdleSec: -1 })
		);
	});
	await page.goto("/");
	const block = page.locator(".ccez-code").first();
	await expect(block).toBeVisible({ timeout: 60_000 });
	await expect(page.locator(".prompt")).toHaveClass(/prompt-idle/, {
		timeout: 10_000
	});
	await block.locator("pre").click();
	// AI code never edits in place: no editing class, and the hidden
	// prompt stays hidden.
	await expect(block).not.toHaveClass(/is-editing/);
	await page.waitForTimeout(600);
	await expect(block).not.toHaveClass(/is-editing/);
	await expect(page.locator(".prompt")).toHaveClass(/prompt-idle/);
});
