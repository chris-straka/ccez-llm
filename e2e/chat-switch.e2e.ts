import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/** New chat mid-stream: the fresh chat stays clean, the origin keeps
its reply, and the sidebar count always matches visible messages. */
test("thinking stays in its own chat across a switch", async ({ page }) => {
	await seedChat(page, []);
	await page.addInitScript(() => {
		localStorage.setItem("ccez-mock-word-ms", "400");
	});
	await page.goto("/");
	await expect(page.locator(".hero")).toBeVisible({ timeout: 60_000 });
	await page.locator(".ta-input").click();
	await page.keyboard.type("please write a long slow reply for this prompt");
	await page.keyboard.press("Enter");
	// Thinking shows in the sending chat.
	await expect(page.locator(".sending")).toBeVisible({ timeout: 10_000 });
	// Locked while thinking: the send button is dead, and Enter keeps
	// the draft (user + empty placeholder = 2 articles, nothing more).
	await expect(page.locator("button.send-btn")).toBeDisabled();
	await page.locator(".ta-input").click();
	await page.keyboard.type("second draft");
	await page.keyboard.press("Enter");
	await expect(page.locator(".ta-input")).toHaveValue("second draft");
	await expect(page.locator("article")).toHaveCount(2);
	// Away: the new chat is pristine — no borrowed Thinking.
	await page.keyboard.press("Meta+b");
	await expect(page.locator("aside").first()).not.toHaveClass(/collapsed/);
	await page.locator('button[aria-label="New chat"]').click();
	await expect(page.locator(".hero")).toBeVisible();
	await expect(page.locator(".sending")).toHaveCount(0);
	await expect(page.locator("article")).toHaveCount(0);
	// Back: the origin kept streaming (or finished) in place.
	// (Minting brings you home, so the list closed like a row-pick:
	// reopen it first — a lingering open list would park the prompt.)
	await page.keyboard.press("Meta+b");
	await expect(page.locator("aside").first()).not.toHaveClass(/collapsed/);
	const rows = page.locator("aside ul li button.side-chat");
	await rows.first().click();

	await expect(page.locator("article.user .rendered")).toContainText(
		"please write",
		{
			timeout: 10_000
		}
	);
	await expect(page.locator("article.assistant .rendered")).toContainText(
		"Mock reply to:",
		{
			timeout: 15_000
		}
	);
	// Count matches visible: one user message, one assistant reply, and
	// the list holds both chats with the origin back on top and active.
	// (Desktop rows carry no per-chat count — the span is phone-only —
	// so the contract here is row presence, order, and active state.)
	await expect(page.locator("article")).toHaveCount(2);
	await expect(page.locator("aside ul li button.side-chat")).toHaveCount(2);
	await expect(rows.first()).toHaveClass(/active/);
});

/** Entering another chat never summons the prompt: the parked
composer stays parked, focus never lands in it, and only the
messages crossfade (sidebar + prompt cut instantly). */
test("entering another chat never summons the prompt", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({
				hoverAssistantActions: true,
				hoverUserActions: true,
				promptIdleSec: -1
			})
		);
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{
					id: "e2e-first",
					createdAt: 1,
					replyLang: null,
					messages: [
						{
							id: "e2e-m0",
							role: "user",
							content: "first chat",
							usage: null,
							error: null
						}
					]
				},
				{
					id: "e2e-second",
					createdAt: 2,
					replyLang: null,
					messages: [
						{
							id: "e2e-m1",
							role: "user",
							content: "second chat",
							usage: null,
							error: null
						}
					]
				}
			])
		);
	});
	// Record the snapshot scope at capture time: the `messages` name
	// must be on exactly while a transition snapshots (sidebar +
	// prompt cut), and off at rest (a standing name traps annotation
	// badges under the header strip).
	await page.addInitScript(() => {
		const seen: string[] = [];
		(window as unknown as Record<string, unknown>).__vtNames = seen;
		const proto = Document.prototype as unknown as {
			startViewTransition?: (opts: { update: () => void }) => {
				finished: Promise<unknown>;
			};
		};
		const real = proto.startViewTransition;
		if (typeof real === "function") {
			proto.startViewTransition = function (
				this: Document,
				opts: { update: () => void }
			): { finished: Promise<unknown> } {
				seen.push(
					getComputedStyle(document.querySelector(".messages")!)
						.viewTransitionName
				);
				return real.call(this, opts);
			};
		}
	});
	await page.goto("/");
	await expect(page.locator("article .rendered")).toBeVisible({
		timeout: 60_000
	});
	await expect(page.locator(".prompt")).toHaveClass(/prompt-idle/, {
		timeout: 10_000
	});
	await page.keyboard.press("Meta+Shift+[");
	const sidebar = page.locator("aside:not(.settings-panel)");
	await expect(sidebar).not.toHaveClass(/collapsed/, { timeout: 5_000 });
	await sidebar.locator("ul li button.side-chat").nth(1).click();
	await expect(sidebar).toHaveClass(/collapsed/, { timeout: 5_000 });
	// Switched, and the prompt never woke: still parked, unfocused.
	await expect(page.locator("article .rendered")).toContainText("second chat", {
		timeout: 10_000
	});
	await expect(page.locator(".prompt")).toHaveClass(/prompt-idle/);
	const focused = await page.evaluate(
		() => !!document.activeElement?.closest?.(".prompt")
	);
	expect(focused).toBe(false);
	// The crossfade was scoped to the messages (every snapshot saw
	// the name), and the scope is off again at rest.
	const vtNames = await page.evaluate(
		() => (window as unknown as Record<string, unknown>).__vtNames as string[]
	);
	expect(vtNames.length).toBeGreaterThan(0);
	for (const name of vtNames) expect(name).toBe("messages");
	const vtRest = await page.evaluate(
		() =>
			getComputedStyle(document.querySelector(".messages") as Element)
				.viewTransitionName
	);
	expect(vtRest).toBe("none");
});

/** The Thinking row keeps breathing room: explicit margins stand it
off the last message above (never the pair-hug gap alone). */
test("thinking row keeps breathing room", async ({ page }) => {
	await seedChat(page, []);
	await page.addInitScript(() => {
		localStorage.setItem("ccez-mock-word-ms", "400");
	});
	await page.goto("/");
	await expect(page.locator(".hero")).toBeVisible({ timeout: 60_000 });
	await page.locator(".ta-input").click();
	await page.keyboard.type("please write a reply");
	await page.keyboard.press("Enter");
	const sending = page.locator(".sending");
	await expect(sending).toBeVisible({ timeout: 10_000 });
	// Explicit margins, not UA happenstance.
	const margins = await sending.evaluate((el) => {
		const style = getComputedStyle(el);
		return {
			top: parseFloat(style.marginTop),
			bottom: parseFloat(style.marginBottom)
		};
	});
	expect(margins.top).toBeGreaterThan(12);
	expect(margins.bottom).toBeGreaterThan(12);
	// And the visual gap above the last message shows it.
	const above = await sending.evaluate((el) => {
		const prev = el.previousElementSibling?.getBoundingClientRect();
		if (!prev) return null;
		return el.getBoundingClientRect().top - prev.bottom;
	});
	expect(above).not.toBeNull();
	expect(above ?? 0).toBeGreaterThan(12);
});
