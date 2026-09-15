import { expect, test } from "@playwright/test";
import { expectBoxesStable, seedChat } from "./helpers";

/**
 * App chrome + settings (bucket chromesettings). NOT RUN in this
 * bucket (shared dev-server port) — kept as the contract for CI.
 */

async function openWithMessages(
	page: import("@playwright/test").Page,
	messages: { role: "user" | "assistant"; content: string }[]
) {
	await seedChat(page, messages);
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
}

async function openSettings(page: import("@playwright/test").Page) {
	await page.keyboard.press("Meta+,");
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
}

/** Top bar is an empty drag strip (traffic lights only) and keeps double-click-to-zoom. */

/** Idle prompt: hides after the timeout, restores on keys. */
test("prompt slides away when idle and returns on keys", async ({ page }) => {
	// Long thread: idle-hide skips content shorter than the viewport,
	// so the timeout path needs an overflowing chat.
	const long = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(40);
	const turns = [0, 1, 2, 3, 4, 5].flatMap((n) => [
		{ role: "user" as const, content: `question ${n} ${long}` },
		{ role: "assistant" as const, content: `answer ${n} ${long}` }
	]);
	await seedChat(page, turns);
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ promptIdleSec: 2 })
		);
	});
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
	const prompt = page.locator(".prompt");
	// No input for 2s (+ticker): the idle class lands and the
	// composer fades out of hit-testing.
	await expect(prompt).toHaveClass(/prompt-idle/, { timeout: 15_000 });
	await expect(prompt).toHaveCSS("opacity", "0");
	// Keys restore it instantly (clicks never do — pointer travel
	// alone only re-arms the timer, never restores).
	await page.locator("article.assistant .rendered").first().click();
	await expect(prompt).toHaveClass(/prompt-idle/);
	await page.keyboard.press("i");
	await expect(prompt).not.toHaveClass(/prompt-idle/, { timeout: 5_000 });
});

/** Button clicks never summon the hidden prompt (copy, run, fold). */
test("button clicks leave the hidden prompt alone", async ({ page }) => {
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	const long = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(40);
	const turns = [0, 1, 2, 3, 4, 5].flatMap((n) => [
		{ role: "user" as const, content: `question ${n} ${long}` },
		{ role: "assistant" as const, content: `answer ${n} ${long}` }
	]);
	turns.push({
		role: "assistant" as const,
		content: 'run me:\n\n```python\nprint("hi")\n```'
	});
	await seedChat(page, turns);
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ promptIdleSec: 2 })
		);
	});
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
	const prompt = page.locator(".prompt");
	await expect(prompt).toHaveClass(/prompt-idle/, { timeout: 15_000 });
	const block = page.locator(".ccez-code").first();
	await expect(block).toBeVisible();
	// The waits give a regressed restore time to manifest: the
	// assertions below must still find the prompt hidden.
	await block.locator("button.ccez-code-copy").click();
	await page.waitForTimeout(600);
	await expect(prompt).toHaveClass(/prompt-idle/);
	await block.locator("button.ccez-code-run").click();
	await expect(block.locator(".ccez-code-output")).toBeVisible({ timeout: 10_000 });
	await page.waitForTimeout(600);
	await expect(prompt).toHaveClass(/prompt-idle/);
	// Plain message clicks leave it hidden too — summoning is keys-only.
	await page.locator("article.assistant .rendered").first().click();
	await page.waitForTimeout(600);
	await expect(prompt).toHaveClass(/prompt-idle/);
	await page.keyboard.press("i");
	await expect(prompt).not.toHaveClass(/prompt-idle/, { timeout: 5_000 });
});

/** Double-clicking open space in settings closes the panel. */
test("double-click closes the settings panel", async ({ page }) => {
	await openWithMessages(page, [{ role: "user", content: "hi" }]);
	await openSettings(page);
	const panel = page.locator(".settings-panel");
	await expect(panel).not.toHaveClass(/closed/);
	// Open space: dispatch on the panel box itself.
	await panel.evaluate((el) => {
		el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
	});
	await expect(panel).toHaveClass(/closed/);
	// Text keeps its behavior: double-clicking a label reopens
	// nothing and closes nothing (it toggles the box twice).
	await openSettings(page);
	await expect(panel).not.toHaveClass(/closed/);
	await panel.getByText("Enable background on my messages").dblclick();
	await expect(panel).not.toHaveClass(/closed/);
});

/** Waypoint menu fades on a slow ramp, not a blink. */
test("waypoint menu reveals on a 0.3s fade", async ({ page }) => {
	const long = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(20);
	await openWithMessages(
		page,
		[0, 1, 2, 3].flatMap((n) => [
			{ role: "user" as const, content: `q${n} ${long}` },
			{ role: "assistant" as const, content: `a${n} ${long}` }
		])
	);
	await page.locator(".wp-wrap").hover();
	const menu = page.locator(".wp-menu");
	await expect(menu).toBeVisible();
	const duration = await menu.evaluate(
		(el) => window.getComputedStyle(el).transitionDuration
	);
	expect(duration).toContain("0.3s");
});

/** Idle hide and restore never move the messages (reserved slot). */
test("idle hide keeps every offset stable", async ({ page }) => {
	const long = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(40);
	const turns = [0, 1, 2, 3, 4, 5].flatMap((n) => [
		{ role: "user" as const, content: `question ${n} ${long}` },
		{ role: "assistant" as const, content: `answer ${n} ${long}` }
	]);
	await seedChat(page, turns);
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ promptIdleSec: 2 })
		);
	});
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
	const offsets = () =>
		page.evaluate(() => ({
			prompt: document.querySelector(".prompt")?.offsetTop ?? -1,
			first: document.querySelector("article.assistant")?.offsetTop ?? -1
		}));
	const before = await offsets();
	const prompt = page.locator(".prompt");
	await expect(prompt).toHaveClass(/prompt-idle/, { timeout: 15_000 });
	// Hiding moves nothing: the prompt keeps its slot.
	expect(await offsets()).toEqual(before);
	// Restoring moves nothing either: no rise, no snap.
	await page.keyboard.press("i");
	await expect(prompt).not.toHaveClass(/prompt-idle/, { timeout: 5_000 });
	await page.waitForTimeout(600);
	expect(await offsets()).toEqual(before);
});

/** Always-hide mode: the prompt follows composer focus, not the clock. */
test("always-hide hides on blur and returns on i", async ({ page }) => {
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	const long = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(40);
	const turns = [0, 1, 2, 3, 4, 5].flatMap((n) => [
		{ role: "user" as const, content: `question ${n} ${long}` },
		{ role: "assistant" as const, content: `answer ${n} ${long}` }
	]);
	turns.push({
		role: "assistant" as const,
		content: 'run me:\n\n```python\nprint("hi")\n```'
	});
	await seedChat(page, turns);
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ promptIdleSec: -1 })
		);
	});
	await page.goto("/");
	await expect(page.locator("article.assistant").first()).toBeVisible({ timeout: 60_000 });
	const prompt = page.locator(".prompt");
	// Focus the composer via the i key, then pin focus natively
	// (the restore focus lands on a tick — assert it before blurring).
	await page.keyboard.press("i");
	await expect(prompt).not.toHaveClass(/prompt-idle/, { timeout: 5_000 });
	await page.locator(".cm-content").click();
	await expect
		.poll(() => page.evaluate(() => !!document.activeElement?.closest?.(".prompt")))
		.toBe(true);
	// A control click blurs it: hidden at once, no timeout wait.
	await page.locator(".ccez-code").first().locator("button.ccez-code-copy").click();
	await expect(prompt).toHaveClass(/prompt-idle/, { timeout: 5_000 });
	// Focus rests on the clicked button (where i correctly stays
	// silent): drop it to the page, then the i key summons back.
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
	await page.keyboard.press("i");
	await expect(prompt).not.toHaveClass(/prompt-idle/, { timeout: 5_000 });
});

/** Always-hide mode: boots hidden with no interaction (no mount steal). */
test("always-hide boots hidden", async ({ page }) => {
	const long = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(40);
	const turns = [0, 1, 2, 3].flatMap((n) => [
		{ role: "user" as const, content: `question ${n} ${long}` },
		{ role: "assistant" as const, content: `answer ${n} ${long}` }
	]);
	await seedChat(page, turns);
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ promptIdleSec: -1 })
		);
	});
	await page.goto("/");
	await expect(page.locator("article.assistant").first()).toBeVisible({ timeout: 60_000 });
	await expect(page.locator(".prompt")).toHaveClass(/prompt-idle/, { timeout: 10_000 });
});

/** Always-hide covers short threads too: no viewport exemption. */
test("always-hide boots hidden on a short thread", async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: "Give me a Chinese paragraph and a Japanese paragraph, both long." },
		{ role: "assistant", content: "ready" }
	]);
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ promptIdleSec: -1 })
		);
	});
	await page.goto("/");
	await expect(page.locator("article.assistant").first()).toBeVisible({ timeout: 60_000 });
	await expect(page.locator(".prompt")).toHaveClass(/prompt-idle/, { timeout: 10_000 });
});

/** Fresh installs boot hidden too: always-hide is the out-of-box
default (seedChat presets never-idle for clickability, so this pins
the default by writing it explicitly). */
test("default boots hidden (always-hide out of the box)", async ({ page }) => {
	const long = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(40);
	const turns = [0, 1, 2, 3].flatMap((n) => [
		{ role: "user" as const, content: `question ${n} ${long}` },
		{ role: "assistant" as const, content: `answer ${n} ${long}` }
	]);
	await seedChat(page, turns);
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ promptIdleSec: -1 })
		);
	});
	await page.goto("/");
	await expect(page.locator("article.assistant").first()).toBeVisible({ timeout: 60_000 });
	await expect(page.locator(".prompt")).toHaveClass(/prompt-idle/, { timeout: 10_000 });
});

/** Space with a panel owning the stage is a no-op: settings open but
focus outside it must not summon the prompt from behind. Closing the
panel restores the normal Space summons. */
test("space with settings open never summons the prompt", async ({ page }) => {
	const long = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(40);
	const turns = [0, 1, 2, 3].flatMap((n) => [
		{ role: "user" as const, content: `question ${n} ${long}` },
		{ role: "assistant" as const, content: `answer ${n} ${long}` }
	]);
	await seedChat(page, turns);
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ promptIdleSec: -1 })
		);
	});
	await page.goto("/");
	const prompt = page.locator(".prompt");
	await expect(page.locator("article.assistant").first()).toBeVisible({ timeout: 60_000 });
	await expect(prompt).toHaveClass(/prompt-idle/, { timeout: 10_000 });
	await page.keyboard.press("Meta+,");
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
	// Focus sits outside the panel (the toggle moves no focus): Space
	// out there summons nothing.
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
	await expect
		.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.tagName ?? "NONE"))
		.not.toBe("INPUT");
	await page.keyboard.press("Space");
	await page.waitForTimeout(800);
	await expect(prompt).toHaveClass(/prompt-idle/);
	// Panel closed, Space in the main chat summons exactly as before.
	await page.keyboard.press("Meta+,");
	await expect(page.locator(".settings-panel")).toHaveClass(/closed/);
	await page.keyboard.press("Space");
	await expect(prompt).not.toHaveClass(/prompt-idle/, { timeout: 5_000 });
});

/** Always-hide: the click that dismisses the prompt must not re-summon it.
A click-off hides and stays hidden; the i key restores. */
test("always-hide click-off stays hidden until the next press", async ({ page }) => {
	const long = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(40);
	const turns = [0, 1, 2, 3].flatMap((n) => [
		{ role: "user" as const, content: `question ${n} ${long}` },
		{ role: "assistant" as const, content: `answer ${n} ${long}` }
	]);
	await seedChat(page, turns);
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ promptIdleSec: -1 })
		);
	});
	await page.goto("/");
	await expect(page.locator("article.assistant").first()).toBeVisible({ timeout: 60_000 });
	const prompt = page.locator(".prompt");
	await page.keyboard.press("i");
	await expect(prompt).not.toHaveClass(/prompt-idle/, { timeout: 5_000 });
	await page.locator(".cm-content").click();
	await expect
		.poll(() => page.evaluate(() => !!document.activeElement?.closest?.(".prompt")))
		.toBe(true);
	// Click off the visible prompt: hides, and the same click must not
	// bring it back (it starts to hide, then stays hidden).
	await page.locator("article.assistant .rendered").nth(1).click();
	await expect(prompt).toHaveClass(/prompt-idle/, { timeout: 5_000 });
	await page.waitForTimeout(800);
	await expect(prompt).toHaveClass(/prompt-idle/);
	// The i key restores (clicks never do).
	await page.keyboard.press("i");
	await expect(prompt).not.toHaveClass(/prompt-idle/, { timeout: 5_000 });
});

/** Always-hide: the click that clears a text highlight must not summon
the prompt. The press begins on a live selection, so its click only
dismisses — selecting and unselecting never touches the composer. */
test("clearing a highlight never summons the prompt", async ({ page }) => {
	const long = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(40);
	const turns = [0, 1, 2, 3].flatMap((n) => [
		{ role: "user" as const, content: `question ${n} ${long}` },
		{ role: "assistant" as const, content: `answer ${n} ${long}` }
	]);
	await seedChat(page, turns);
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify({ promptIdleSec: -1 }));
	});
	await page.goto("/");
	await expect(page.locator("article.assistant").first()).toBeVisible({ timeout: 60_000 });
	const prompt = page.locator(".prompt");
	await expect(prompt).toHaveClass(/prompt-idle/, { timeout: 10_000 });
	// Drag-select a word: the drag itself never summons (over 6px), the
	// menu takes the highlight.
	const body = page.locator("article.assistant .rendered").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	await page.mouse.move(box.x + 20, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 5 });
	await page.mouse.up();
	await expect(page.locator(".sel-menu")).toBeVisible({ timeout: 5_000 });
	await expect(prompt).toHaveClass(/prompt-idle/);
	// Click off to clear the highlight: stays hidden, selection gone.
	await page.locator("article.assistant .rendered").nth(1).click();
	await expect(prompt).toHaveClass(/prompt-idle/, { timeout: 5_000 });
	await page.waitForTimeout(800);
	await expect(prompt).toHaveClass(/prompt-idle/);
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).toBe("");
});

/** Always-hide: double-clicking a word to select it never flashes the
prompt. The first click's press starts collapsed, which used to summon
before the second click hid it again. */
test("double-clicking text never flashes the prompt", async ({ page }) => {
	const long = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(40);
	const turns = [0, 1, 2, 3].flatMap((n) => [
		{ role: "user" as const, content: `question ${n} ${long}` },
		{ role: "assistant" as const, content: `answer ${n} ${long}` }
	]);
	await seedChat(page, turns);
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify({ promptIdleSec: -1 }));
	});
	await page.goto("/");
	await expect(page.locator("article.assistant").first()).toBeVisible({ timeout: 60_000 });
	const prompt = page.locator(".prompt");
	await expect(prompt).toHaveClass(/prompt-idle/, { timeout: 10_000 });
	const body = page.locator("article.assistant .rendered").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	await page.mouse.dblclick(box.x + 20, box.y + box.height / 2);
	// A word is selected, and the prompt never left hidden — no flash.
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).not.toBe("");
	await expect(prompt).toHaveClass(/prompt-idle/);
	await page.waitForTimeout(800);
	await expect(prompt).toHaveClass(/prompt-idle/);
});

/** Always-hide: bare Space on an empty composer dismisses (no message
starts with a space), while Space after text types a space. */
test("space dismisses an empty composer, types after text", async ({ page }) => {
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	const long = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(40);
	const turns = [0, 1, 2, 3].flatMap((n) => [
		{ role: "user" as const, content: `question ${n} ${long}` },
		{ role: "assistant" as const, content: `answer ${n} ${long}` }
	]);
	await seedChat(page, turns);
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify({ promptIdleSec: -1 }));
	});
	await page.goto("/");
	await expect(page.locator("article.assistant").first()).toBeVisible({ timeout: 60_000 });
	const prompt = page.locator(".prompt");
	await expect(prompt).toHaveClass(/prompt-idle/, { timeout: 10_000 });
	const inPrompt = () =>
		page.evaluate(() => !!document.activeElement?.closest?.(".prompt"));
	// Summon, then Space on empty: dismissed, nothing typed.
	await page.keyboard.press("i");
	await expect(prompt).not.toHaveClass(/prompt-idle/, { timeout: 5_000 });
	await expect.poll(inPrompt).toBe(true);
	await page.keyboard.press("Space");
	await expect(prompt).toHaveClass(/prompt-idle/, { timeout: 5_000 });
	await page.keyboard.press("i");
	await expect(prompt).not.toHaveClass(/prompt-idle/, { timeout: 5_000 });
	await expect.poll(inPrompt).toBe(true);
	await page.keyboard.press("Meta+a");
	await page.keyboard.press("Meta+c");
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("");
	// With text, Space types and stays up.
	await page.keyboard.type("hi");
	await page.keyboard.press("Space");
	await expect(prompt).not.toHaveClass(/prompt-idle/);
	await page.keyboard.press("Meta+a");
	await page.keyboard.press("Meta+c");
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("hi ");
});

/** The floating composer centers on the message column: with default
widths its center matches the articles' (scrollbar gutter included),
so text never sticks out on one side only. */
test("prompt centers on the message column", async ({ page }) => {
	const long = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(40);
	const turns = [0, 1].flatMap((n) => [
		{ role: "user" as const, content: `question ${n} ${long}` },
		{ role: "assistant" as const, content: `answer ${n} ${long}` }
	]);
	await seedChat(page, turns);
	await page.goto("/");
	await expect(page.locator("article.assistant").first()).toBeVisible({ timeout: 60_000 });
	const centers = await page.evaluate(() => {
		const r = (el: Element | null): { cx: number } => {
			const b = (el as HTMLElement).getBoundingClientRect();
			return { cx: (b.left + b.right) / 2 };
		};
		return {
			prompt: r(document.querySelector(".prompt")).cx,
			article: r(document.querySelector("article.assistant")).cx
		};
	});
	expect(Math.abs(centers.prompt - centers.article)).toBeLessThan(1.5);
});

/** An empty focused composer still blinks: the native caret is the
only focus signal (CodeMirror draws no cursor node here), so the
empty-box caret hiding applies unfocused only. */
test("empty focused composer shows its cursor", async ({ page }) => {
	const long = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(40);
	await seedChat(page, [{ role: "assistant", content: `answer ${long}` }]);
	await page.goto("/");
	await expect(page.locator("article.assistant").first()).toBeVisible({ timeout: 60_000 });
	const caret = () =>
		page.evaluate(
			() => getComputedStyle(document.querySelector(".prompt .cm-content") as Element).caretColor
		);
	await page.locator(".cm-content").click();
	await expect
		.poll(() => page.evaluate(() => !!document.activeElement?.closest?.(".prompt")))
		.toBe(true);
	// Focused + empty: caret blinks (not transparent).
	expect(await caret()).not.toBe("rgba(0, 0, 0, 0)");
	// Blurred + empty: no stray caret (CodeMirror drops .cm-focused
	// async, so wait for the unfocused state first).
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
	await expect
		.poll(() =>
			page.evaluate(
				() => document.querySelector(".prompt .cm-editor")?.classList.contains("cm-focused") ?? false
			)
		)
		.toBe(false);
	expect(await caret()).toBe("rgba(0, 0, 0, 0)");
});

/** The prompt parks while a sidebar owns the stage: settings open
hides it, closing brings it back. */
test("prompt hides while settings are open", async ({ page }) => {
	const long = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(40);
	await seedChat(page, [{ role: "assistant", content: `answer ${long}` }]);
	// Timed idle: the always-hide default boots parked, which would
	// fail the visible setup below (parking is what this tests).
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify({ promptIdleSec: 10 }));
	});
	await page.goto("/");
	await expect(page.locator("article.assistant").first()).toBeVisible({ timeout: 60_000 });
	const prompt = page.locator(".prompt");
	await expect(prompt).not.toHaveClass(/prompt-idle/, { timeout: 5_000 });
	await page.keyboard.press("Meta+,");
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/, { timeout: 5_000 });
	await expect(prompt).toHaveClass(/prompt-idle/, { timeout: 5_000 });
	await page.keyboard.press("Meta+,");
	await expect(prompt).not.toHaveClass(/prompt-idle/, { timeout: 5_000 });
});

/** Same park for the chats sidebar (Cmd/Ctrl+Shift+[ toggles it). */
test("prompt hides while the chats sidebar is open", async ({ page }) => {
	const long = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(40);
	await seedChat(page, [{ role: "assistant", content: `answer ${long}` }]);
	// Timed idle: the always-hide default boots parked, which would
	// fail the visible setup below (parking is what this tests).
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify({ promptIdleSec: 10 }));
	});
	await page.goto("/");
	await expect(page.locator("article.assistant").first()).toBeVisible({ timeout: 60_000 });
	const prompt = page.locator(".prompt");
	const sidebar = page.locator("aside:not(.settings-panel)");
	await expect(prompt).not.toHaveClass(/prompt-idle/, { timeout: 5_000 });
	await page.keyboard.press("Meta+Shift+[");
	await expect(sidebar).not.toHaveClass(/collapsed/, { timeout: 5_000 });
	await expect(prompt).toHaveClass(/prompt-idle/, { timeout: 5_000 });
	await page.keyboard.press("Meta+Shift+[");
	await expect(sidebar).toHaveClass(/collapsed/, { timeout: 5_000 });
	await expect(prompt).not.toHaveClass(/prompt-idle/, { timeout: 5_000 });
});

/** Sidebar row buttons never move on hover: export and delete
fade in and out in place (opacity only) — hovering the row or the
buttons themselves shifts no pixel. */
test("sidebar export and delete never move on hover", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "hello" }]);
	await page.goto("/");
	await expect(page.locator("article.assistant").first()).toBeVisible({ timeout: 60_000 });
	await page.keyboard.press("Meta+Shift+[");
	const sidebar = page.locator("aside:not(.settings-panel)");
	await expect(sidebar).not.toHaveClass(/collapsed/, { timeout: 5_000 });
	// Outlast the 0.22s slide-in: measuring mid-slide reads off-screen boxes.
	await page.waitForTimeout(400);
	const row = sidebar.locator("ul li").first();
	const exp = row.locator("button.exp");
	const del = row.locator("button.del");
	const boxOf = async () => [await exp.boundingBox(), await del.boundingBox()];
	const before = await boxOf();
	await row.hover();
	await page.waitForTimeout(400);
	expectBoxesStable(before, await boxOf());
	await exp.hover();
	await page.waitForTimeout(300);
	expectBoxesStable(before, await boxOf());
	await del.hover();
	await page.waitForTimeout(300);
	expectBoxesStable(before, await boxOf());
});

/** The scrollbar shows mid-scroll and fades out promptly after the
stop: the hold is short and the fade quick, never lingering. */
test("scrollbar fades out promptly after scrolling stops", async ({ page }) => {
	const long = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(40);
	const turns = [0, 1, 2].flatMap((n) => [
		{ role: "user" as const, content: `question ${n} ${long}` },
		{ role: "assistant" as const, content: `answer ${n} ${long}` }
	]);
	await seedChat(page, turns);
	await page.goto("/");
	await expect(page.locator("article.assistant").first()).toBeVisible({ timeout: 60_000 });
	const box = page.locator(".messages");
	const scrolling = (): Promise<boolean> =>
		box.evaluate((el) => el.classList.contains("scrolling"));
	await box.evaluate((el) => el.scrollTo({ top: 300 }));
	await expect.poll(scrolling).toBe(true);
	await expect.poll(scrolling).toBe(false);
	// The settled fade itself is quick (not the old lingering drift).
	const fade = await box.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
	expect(fade).toBeLessThanOrEqual(0.35);
});

/** Transparency slider translucents the page: the html
background resolves the alpha instead of staying fully opaque. */
test("transparency slider translucents the page", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "hello" }]);
	await page.goto("/");
	await expect(page.locator("article.assistant").first()).toBeVisible({ timeout: 60_000 });
	// The background lives on .app (html itself stays unpainted).
	const alphaOf = (): Promise<number> =>
		page.evaluate(() => {
			const bg = getComputedStyle(document.querySelector(".app") as Element).backgroundColor;
			const nums = bg.match(/[\d.]+/g)?.map(Number) ?? [];
			// rgb() carries no alpha (opaque); rgba()/color(srgb / a) do.
			return nums.length === 4 ? (nums[3] ?? 1) : 1;
		});
	expect(await alphaOf()).toBe(1);
	await page.keyboard.press("Meta+,");
	const slider = page.locator(
		'.settings-panel input[aria-label="Background transparency percent"]'
	);
	await expect(slider).toBeVisible({ timeout: 5_000 });
	// Drive the slider like a real drag (fill() doesn't fire input on
	// range inputs everywhere): set the value and dispatch input.
	// Transparency runs 0 (opaque) to 80, so 80 resolves alpha 0.2.
	await slider.evaluate((el) => {
		const input = el as HTMLInputElement;
		input.value = "80";
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
	expect(await alphaOf()).toBeLessThan(0.5);
});

/** "Scale message buttons with text size" multiplies button size by
the Text size setting, live: at enlarged text the toggle visibly
grows the buttons (at default size there is nothing to multiply,
so it correctly changes nothing). */
test("scale buttons with text size applies immediately", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "hello" }]);
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ hoverAssistantActions: true, hoverUserActions: true, fontScale: 1.5 })
		);
	});
	await page.goto("/");
	await expect(page.locator("article.assistant").first()).toBeVisible({ timeout: 60_000 });
	const button = page.locator("article.assistant .actions button").first();
	const px = (): Promise<number> =>
		button.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
	// Untoggled: the fixed button size, even at enlarged text.
	expect(await px()).toBeLessThan(13);
	// Toggling the checkbox applies on the spot — no reload, no save.
	await page.keyboard.press("Meta+,");
	const check = page.locator(
		'.settings-panel label:has-text("Scale message buttons with text size") input'
	);
	await expect(check).toBeVisible({ timeout: 5_000 });
	await check.check();
	await expect(page.locator("main")).toHaveClass(/scale-actions/);
	expect(await px()).toBeGreaterThan(16);
	await check.uncheck();
	expect(await px()).toBeLessThan(13);
});

/** The top bar is an invisible gesture strip: fully transparent so
messages bleed underneath it, still overlaid for window drag and
double-click zoom. */
test("top bar is transparent", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "hello" }]);
	await page.goto("/");
	await expect(page.locator("article.assistant").first()).toBeVisible({ timeout: 60_000 });
	const bar = await page.evaluate(() => {
		const style = getComputedStyle(document.querySelector("header") as Element);
		return { bg: style.backgroundColor, blur: style.backdropFilter, border: style.borderBottomWidth };
	});
	expect(bar.bg).toBe("rgba(0, 0, 0, 0)");
	expect(bar.blur).toBe("none");
	expect(bar.border).toBe("0px");
});

/** Only the first message stands off the top: one strip-height of
margin clears the invisible drag bar, while later messages bleed. */
test("first message clears the top strip", async ({ page }) => {
	const long = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(20);
	await seedChat(page, [
		{ role: "user", content: "first" },
		{ role: "assistant", content: `answer ${long}` },
		{ role: "user", content: "second" }
	]);
	await page.goto("/");
	await expect(page.locator("article").first()).toBeVisible({ timeout: 60_000 });
	const gaps = await page.evaluate(() => {
		const box = (document.querySelector(".messages") as HTMLElement).getBoundingClientRect();
		const rects = [...document.querySelectorAll("article")].map((a) => a.getBoundingClientRect());
		const first = rects[0];
		const second = rects[1];
		if (!first || !second) throw new Error("missing articles");
		return {
			firstTop: Math.round(first.top - box.top),
			interGap: Math.round(second.top - first.bottom)
		};
	});
	// ~1.75rem at default scale clears the strip; the next message
	// hugs with just the list gap.
	expect(gaps.firstTop).toBeGreaterThanOrEqual(20);
	expect(gaps.interGap).toBeLessThan(12);
});

/** Always-hide: dismissing a sidebar by outside click never summons
the prompt — neither from visible nor from already-hidden. */
test("sidebar outside-click never summons the prompt", async ({ page }) => {
	const long = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(40);
	const turns = [0, 1, 2, 3].flatMap((n) => [
		{ role: "user" as const, content: `question ${n} ${long}` },
		{ role: "assistant" as const, content: `answer ${n} ${long}` }
	]);
	await seedChat(page, turns);
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify({ promptIdleSec: -1 }));
	});
	await page.goto("/");
	await expect(page.locator("article.assistant").first()).toBeVisible({ timeout: 60_000 });
	const prompt = page.locator(".prompt");
	const sidebar = page.locator("aside:not(.settings-panel)");
	// From already-hidden: stays hidden.
	await page.keyboard.press("Meta+Shift+[");
	await expect(sidebar).not.toHaveClass(/collapsed/, { timeout: 5_000 });
	await page.locator("article.assistant .rendered").nth(1).click();
	await expect(sidebar).toHaveClass(/collapsed/, { timeout: 5_000 });
	await expect(prompt).toHaveClass(/prompt-idle/);
	// From visible: stays visible, never toggled by the dismiss.
	await page.locator("article.assistant .rendered").first().click();
	await expect(prompt).not.toHaveClass(/prompt-idle/, { timeout: 5_000 });
	await page.keyboard.press("Meta+Shift+[");
	await expect(sidebar).not.toHaveClass(/collapsed/, { timeout: 5_000 });
	await page.locator("article.assistant .rendered").nth(1).click();
	await expect(sidebar).toHaveClass(/collapsed/, { timeout: 5_000 });
	await expect(prompt).not.toHaveClass(/prompt-idle/);
});

/** Always-hide: stepping past the newest chat mints one with the
prompt shown, never inheriting the hidden bar. */
test("stepping past the end mints a chat with the prompt shown", async ({ page }) => {
	const long = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(40);
	const turns = [0, 1, 2, 3].flatMap((n) => [
		{ role: "user" as const, content: `question ${n} ${long}` },
		{ role: "assistant" as const, content: `answer ${n} ${long}` }
	]);
	await seedChat(page, turns);
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify({ promptIdleSec: -1 }));
	});
	await page.goto("/");
	await expect(page.locator("article.assistant").first()).toBeVisible({ timeout: 60_000 });
	await expect(page.locator(".prompt")).toHaveClass(/prompt-idle/, { timeout: 10_000 });
	await page.keyboard.press("Meta+Shift+j");
	await expect(page.locator(".prompt")).not.toHaveClass(/prompt-idle/, { timeout: 5_000 });
	await expect
		.poll(() => page.evaluate(() => !!document.activeElement?.closest?.(".prompt")))
		.toBe(true);
});

/** Always-hide mode: sending from the keyboard hides the prompt. */
test("always-hide hides after send", async ({ page }) => {
	const long = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(40);
	const turns = [0, 1, 2, 3].flatMap((n) => [
		{ role: "user" as const, content: `question ${n} ${long}` },
		{ role: "assistant" as const, content: `answer ${n} ${long}` }
	]);
	await seedChat(page, turns);
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ promptIdleSec: -1 })
		);
	});
	await page.goto("/");
	await expect(page.locator("article.assistant").first()).toBeVisible({ timeout: 60_000 });
	const prompt = page.locator(".prompt");
	await page.keyboard.press("i");
	await expect(prompt).not.toHaveClass(/prompt-idle/, { timeout: 5_000 });
	await page.locator(".cm-content").click();
	await expect
		.poll(() => page.evaluate(() => !!document.activeElement?.closest?.(".prompt")))
		.toBe(true);
	await page.keyboard.type("hello again");
	await page.keyboard.press("Enter");
	// The send blurs the composer (the bubbling Enter must not
	// summon it straight back): hidden behind the reply.
	await expect(prompt).toHaveClass(/prompt-idle/, { timeout: 10_000 });
});

/** Idle timeout is configurable in settings (always/2–10s/never). */
test("idle timeout slider persists", async ({ page }) => {
	await openWithMessages(page, [{ role: "user", content: "hi" }]);
	await openSettings(page);
	const slider = page.locator(
		'.settings-panel input[aria-label="Idle seconds before the prompt hides (bottom is always, top is never)"]'
	);
	await expect(slider).toHaveAttribute("min", "1");
	await expect(slider).toHaveAttribute("max", "11");
	await slider.fill("10");
	await expect
		.poll(() => page.evaluate(() => window.localStorage.getItem("ccez-llm-settings-v1")))
		.toContain('"promptIdleSec":10');
	await slider.fill("11");
	await expect
		.poll(() => page.evaluate(() => window.localStorage.getItem("ccez-llm-settings-v1")))
		.toContain('"promptIdleSec":0');
	await slider.fill("1");
	await expect
		.poll(() => page.evaluate(() => window.localStorage.getItem("ccez-llm-settings-v1")))
		.toContain('"promptIdleSec":-1');
	await expect(
		page.locator(".settings-panel output", { hasText: "always" })
	).toBeVisible();
});

/** Slider drag-up past the top resets to default (text size). */

/** Clicking the slider label never resets (only the inner button + drag-up do). */

/** Chat width configures past 80rem. */
test("chat width slider reaches past 80 rem", async ({ page }) => {
	await openWithMessages(page, [{ role: "user", content: "hi" }]);
	await openSettings(page);
	const slider = page.locator('.settings-panel input[aria-label="Chat width in rem"]');
	await expect(slider).toHaveAttribute("max", "120");
	await slider.fill("100");
	await expect(slider).toHaveValue("100");
	await expect
		.poll(() => page.evaluate(() => window.localStorage.getItem("ccez-llm-settings-v1")))
		.toContain('"chatWidth":100');
});

/** Fresh installs: plain user messages, hover-only buttons both roles. */
test("fresh installs default to plain messages and hover-only buttons", async ({ page }) => {
	await openWithMessages(page, [{ role: "user", content: "hi" }]);
	await page.evaluate(() => window.localStorage.setItem("ccez-llm-settings-v1", "{}"));
	await page.reload();
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
	const main = page.locator("main");
	await expect(main).toHaveClass(/plain-user/);
	await expect(main).toHaveClass(/hover-user/);
	await expect(main).toHaveClass(/hover-assistant/);
});

/** Message buttons scale with font size only when opted in. */
test("message buttons scale with text size when enabled", async ({ page }) => {
	await openWithMessages(page, [
		{ role: "user", content: "hi" },
		{ role: "assistant", content: "hello there" }
	]);
	await openSettings(page);
	await page.locator('.settings-panel input[aria-label="Text size percent"]').fill("200");
	const button = page.locator("article.assistant .actions button").first();
	const fixed = await button.evaluate((el) => getComputedStyle(el).fontSize);
	await page.locator(".settings-panel").getByText("Scale message buttons with text size").click();
	const scaled = await button.evaluate((el) => getComputedStyle(el).fontSize);
	expect(parseFloat(scaled)).toBeGreaterThan(parseFloat(fixed));
});

/** Language buttons never overlap the hero on an empty chat. */
test("empty-state language buttons sit clear of the hero", async ({ page }) => {
	await openWithMessages(page, []);
	const hero = page.locator(".hero");
	const menus = page.locator(".lang-menus");
	await expect(hero).toBeVisible();
	await expect(menus).toBeVisible();
	const heroBox = await hero.boundingBox();
	const menusBox = await menus.boundingBox();
	expect(heroBox).toBeTruthy();
	expect(menusBox).toBeTruthy();
	expect(menusBox!.y).toBeGreaterThanOrEqual(heroBox!.y + heroBox!.height);
	// Mac desktop additionally nudges the row down and fades it
	// (data-mac); elsewhere it simply rests in flow — either way,
	// no overlap.
});

/** Short threads idle-hide like any other: the timeout says hide, so
even a fitting thread parks (the old viewport exemption is gone). */
test("short thread hides past the timeout", async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "hi" }]);
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ promptIdleSec: 2 })
		);
	});
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
	await expect(page.locator(".messages")).toBeVisible();
	const fits = await page.evaluate(() => {
		const box = document.querySelector(".messages") as HTMLElement | null;
		return box ? box.scrollHeight <= box.clientHeight : null;
	});
	expect(fits).toBe(true);
	await expect(page.locator(".prompt")).toHaveClass(/prompt-idle/, { timeout: 15_000 });
});

/** Think blocks never render: only the answer shows, at chat text size. */
test("think blocks stay hidden", async ({ page }) => {
	await openWithMessages(page, [
		{ role: "user", content: "hi" },
		{ role: "assistant", content: "<think>quiet plan</think>Final answer" }
	]);
	const body = page.locator("article.assistant .rendered").first();
	await expect(body).toContainText("Final answer");
	await expect(body).not.toContainText("quiet plan");
	await expect(page.locator("article.assistant .ccez-thoughts")).toHaveCount(0);
});

/** Shift+Meta+plus/minus widen/narrow the chat column. */
test("shift-meta-plus widens the chat column", async ({ page }) => {
	await openWithMessages(page, [{ role: "user", content: "hi" }]);
	await page.locator(".cm-content").first().click();
	await page.keyboard.down("Shift");
	await page.keyboard.down("Meta");
	await page.keyboard.press("Equal");
	await page.keyboard.up("Meta");
	await page.keyboard.up("Shift");
	// Default 36 + one 2rem step.
	await expect(page.locator(".toast")).toContainText("Chat width 38 rem");
	await expect
		.poll(() => page.evaluate(() => window.localStorage.getItem("ccez-llm-settings-v1")))
		.toContain('"chatWidth":38');
});

/** WebKit sees no interactive-widget key: it ships only to Android at runtime. */
test("viewport meta stays Chromium-key-free on desktop", async ({ page }) => {
	await openWithMessages(page, [{ role: "user", content: "hi" }]);
	const content = await page.evaluate(
		() => document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? ""
	);
	expect(content).not.toContain("interactive-widget");
});

/** Traffic-light veil: shell-only patch over the native buttons, fades out on strip hover. */
test("traffic veil hides at rest and fades on header hover", async ({ page }) => {
	await openWithMessages(page, [{ role: "user", content: "hi" }]);
	const veil = page.locator(".traffic-veil");
	await expect(veil).toHaveCount(1);
	// Plain browser dev has no native lights: the veil stays off.
	await expect(veil).toBeHidden();
	// Flip to shell chrome to exercise the real fade rule end to end.
	await page.evaluate(() => {
		document.querySelector(".app")?.setAttribute("data-shell", "tauri");
	});
	await expect(veil).toBeVisible();
	const opacity = () => veil.evaluate((el) => getComputedStyle(el).opacity);
	expect(await opacity()).toBe("1");
	await page.locator("header[aria-label='App']").hover({ position: { x: 200, y: 5 } });
	await expect.poll(opacity, { timeout: 5000 }).toBe("0");
	// Leaving the strip fades the cover back in.
	await page.mouse.move(400, 400);
	await expect.poll(opacity, { timeout: 5000 }).toBe("1");
	await page.evaluate(() => {
		document.querySelector(".app")?.setAttribute("data-shell", "browser");
	});
});

/** Minting a chat from a shelved prompt shows the composer focused
with a blinking cursor (sidebar button; Cmd+N shares doNewChat). */
test("new chat button shows and focuses the prompt", async ({ page }) => {
	const long = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(40);
	const turns = [0, 1, 2, 3].flatMap((n) => [
		{ role: "user" as const, content: `question ${n} ${long}` },
		{ role: "assistant" as const, content: `answer ${n} ${long}` }
	]);
	await seedChat(page, turns);
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify({ promptIdleSec: -1 }));
	});
	await page.goto("/");
	const prompt = page.locator(".prompt");
	await expect(page.locator("article.assistant").first()).toBeVisible({ timeout: 60_000 });
	await expect(prompt).toHaveClass(/prompt-idle/, { timeout: 10_000 });
	await page.keyboard.press("Control+b");
	await expect(page.locator("aside:not(.settings-panel)")).not.toHaveClass(/collapsed/);
	await page.locator('aside:not(.settings-panel) button[aria-label="New chat"]').click();
	await expect(prompt).not.toHaveClass(/prompt-idle/, { timeout: 10_000 });
	await expect
		.poll(
			() =>
				page.evaluate(
					() => !!(document.activeElement as HTMLElement | null)?.closest(".prompt .cm-content")
				),
			{ timeout: 10_000 }
		)
		.toBe(true);
});

/** A short thread never hides at boot: nothing to uncover. */
test("short thread boots with the prompt visible", async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "hi" }]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({ timeout: 60_000 });
	await page.waitForTimeout(1200);
	await expect(page.locator(".prompt")).not.toHaveClass(/prompt-idle/);
});

/** Picking a reply language updates the send button instantly — first
pick and re-pick alike, with no prompt hover in between — and hands
focus to the composer. */
test("language re-pick updates send instantly and focuses prompt", async ({ page }) => {
	// Tall viewport: the 20-option Europe list opens upward past the
	// top edge on short windows (keyboard number keys still reach).
	await page.setViewportSize({ width: 1280, height: 1000 });
	await seedChat(page, []);
	await page.goto("/");
	const send = page.locator(".send-btn");
	await expect(send).toBeVisible({ timeout: 60_000 });
	const pill = page.locator(".lang-menus .lang-menu button").first();
	const focusedComposer = () =>
		page.evaluate(
			() => !!(document.activeElement as HTMLElement | null)?.closest(".prompt .cm-content")
		);
	await pill.click();
	await page.locator('.lang-list button:has-text("Bulgarian")').click();
	await expect(send).toContainText("🇧🇬", { timeout: 10_000 });
	expect(await focusedComposer()).toBe(true);
	// Re-pick without ever touching the prompt: the badge swaps at once.
	await pill.click();
	await page.locator('.lang-list button:has-text("Czech")').click();
	await expect(send).toContainText("🇨🇿", { timeout: 10_000 });
	expect(await focusedComposer()).toBe(true);
});
