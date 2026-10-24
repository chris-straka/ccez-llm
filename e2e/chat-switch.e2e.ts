import { expect, test, type Page } from "./fixtures";
import { seedChat, toggleSidebar } from "./helpers";

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
	await toggleSidebar(page);
	await expect(page.locator("aside").first()).not.toHaveClass(/collapsed/);
	await page.locator('button[aria-label="New chat"]').click();
	await expect(page.locator(".hero")).toBeVisible();
	await expect(page.locator(".sending")).toHaveCount(0);
	await expect(page.locator("article")).toHaveCount(0);
	// Back: the origin kept streaming (or finished) in place.
	// (Minting brings you home, so the list closed like a row-pick:
	// reopen it first — a lingering open list would park the prompt.)
	await toggleSidebar(page);
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
composer stays parked, focus never lands in it, and the switch cuts
instantly (no view transition anywhere). */
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
	// Chat switching snaps instantly: no view transition ever runs
	// (sidebar + prompt + messages all cut in the same flush).
	await page.addInitScript(() => {
		(window as unknown as Record<string, unknown>).__vtCalls = 0;
		const proto = Document.prototype as unknown as {
			startViewTransition?: (opts: { update: () => void }) => {
				finished: Promise<unknown>;
			};
		};
		if (typeof proto.startViewTransition === "function") {
			proto.startViewTransition = function (): {
				finished: Promise<unknown>;
			} {
				(window as unknown as Record<string, unknown>).__vtCalls =
					Number((window as unknown as Record<string, unknown>).__vtCalls) + 1;
				throw new Error("view transitions are gone");
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
	// No view transition ran for the switch (the spy throws, so any
	// call would have failed the switch assertions above).
	const vtCalls = await page.evaluate(
		() => (window as unknown as Record<string, unknown>).__vtCalls as number
	);
	expect(vtCalls).toBe(0);
});

/** ⇧⌘J steps to the newer chat without touching the prompt:
stepping is navigation, never an invitation to type. */
test("shift-cmd-j steps chats without focusing the prompt", async ({
	page
}) => {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		const chat = (id: string, createdAt: number, content: string) => ({
			id,
			createdAt,
			replyLang: null,
			messages: [
				{
					id: `${id}-m0`,
					role: "assistant",
					content,
					usage: null,
					error: null
				}
			]
		});
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				chat("e2e-old", 1, "older chat here"),
				chat("e2e-new", 2, "newer chat here")
			])
		);
	});
	await page.goto("/");
	// Lands on the first seed.
	await expect(page.locator("article .rendered")).toContainText(
		"older chat here",
		{ timeout: 60_000 }
	);
	await page.keyboard.press("Meta+Shift+J");
	await expect(page.locator("article .rendered")).toContainText(
		"newer chat here",
		{ timeout: 10_000 }
	);
	const focused = await page.evaluate(
		() => !!document.activeElement?.closest?.(".prompt")
	);
	expect(focused).toBe(false);
});

/** ⇧⌘J past the newest mints a fresh chat AND lands in the prompt:
opening a new chat is an invitation to type. */
test("shift-cmd-j mint lands focus in the prompt", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{
					id: "e2e-only",
					createdAt: 1,
					replyLang: null,
					messages: [
						{
							id: "e2e-only-m0",
							role: "assistant",
							content: "only chat here",
							usage: null,
							error: null
						}
					]
				}
			])
		);
	});
	await page.goto("/");
	await expect(page.locator("article .rendered")).toContainText(
		"only chat here",
		{ timeout: 60_000 }
	);
	await page.keyboard.press("Meta+Shift+J");
	// Minted: the fresh chat is blank (hero back, no articles).
	await expect(page.locator(".hero")).toBeVisible({ timeout: 10_000 });
	await expect(page.locator("article")).toHaveCount(0);
	// And the prompt woke: focus sits inside it, ready to type.
	const focused = await page.evaluate(
		() => !!document.activeElement?.closest?.(".prompt")
	);
	expect(focused).toBe(true);
	// Again on the still-empty newest (a stay, not a second mint):
	// the fresh chat still opens ready to type.
	await page.locator(".hero").click();
	await page.keyboard.press("Meta+Shift+J");
	await expect(page.locator("article")).toHaveCount(0);
	const refocused = await page.evaluate(
		() => !!document.activeElement?.closest?.(".prompt")
	);
	expect(refocused).toBe(true);
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

/** Rows name each chat by its opening question, the time under it;
a chat with no messages yet reads New chat. */
test("sidebar rows read the opening question over the time", async ({
	page
}) => {
	await page.addInitScript(() => {
		localStorage.setItem("ccez-mock-provider", "1");
		localStorage.setItem("ccez-llm-settings-v1", "{}");
		const msg = (id: string, role: string, content: string) => ({
			id,
			role,
			content,
			usage: null,
			error: null
		});
		localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{ id: "c-new", createdAt: 3, replyLang: null, messages: [] },
				{
					id: "c-de",
					createdAt: 2,
					replyLang: null,
					messages: [
						msg("1", "user", "## Was heißt **über** auf Englisch?"),
						msg("2", "assistant", "Über means over.")
					]
				},
				{
					id: "c-fr",
					createdAt: 1,
					replyLang: null,
					messages: [
						msg("3", "user", "Comment dit-on « window » en français ?")
					]
				}
			])
		);
	});
	await page.goto("/");
	await expect(page.locator(".send-btn")).toBeVisible({ timeout: 60_000 });
	await toggleSidebar(page);
	const titles = page.locator("aside ul li .side-title");
	await expect(titles).toHaveText([
		"New chat",
		"Was heißt über auf Englisch?",
		"Comment dit-on « window » en français ?"
	]);
	await expect(page.locator("aside ul li .side-time").first()).not.toBeEmpty();
	await page.waitForTimeout(400);
	await page.screenshot({ path: ".screenshots/sidebar-titles.png" });
});

/** A first reply names the chat (mock model title); the pencil
renames it, Esc cancels, and the rename persists. */
test("model titles a chat; the pencil renames it", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".hero")).toBeVisible({ timeout: 60_000 });
	await page.locator(".ta-input").click();
	await page.keyboard.type("Was heißt über bitte");
	await page.keyboard.press("Enter");
	await expect(page.locator("article.assistant .rendered")).toContainText(
		"Mock reply",
		{
			timeout: 15_000
		}
	);
	await toggleSidebar(page);
	const title = page.locator("aside ul li .side-title").first();
	await expect(title).toHaveText("Mock title Was heißt über", {
		timeout: 10_000
	});
	const row = page.locator("aside ul li").first();
	await row.hover();
	await row.getByRole("button", { name: "Rename chat" }).click();
	const field = page.getByLabel("Chat name");
	await expect(field).toBeFocused();
	await field.fill("Throwaway");
	await page.keyboard.press("Escape");
	await expect(title).toHaveText("Mock title Was heißt über");
	await row.hover();
	await row.getByRole("button", { name: "Rename chat" }).click();
	await page.getByLabel("Chat name").fill("German prepositions");
	await page.keyboard.press("Enter");
	await expect(title).toHaveText("German prepositions");
	// Persisted with the chat (the seed init script re-runs on a
	// reload, so read storage instead of reloading).
	const stored = await page.evaluate(
		() => localStorage.getItem("ccez-llm-chats-v1") ?? ""
	);
	expect(stored).toContain('"title":"German prepositions"');
	expect(stored).toContain('"titleBy":"user"');
});

/** Shift+R over the open list reads the hovered chat's name. */
test("Shift+R reads the hovered chat's name", async ({ page }) => {
	await page.addInitScript(() => {
		const spoken: string[] = [];
		(window as unknown as { __spoken: string[] }).__spoken = spoken;
		const synth = window.speechSynthesis;
		if (synth) {
			synth.speak = ((utterance: SpeechSynthesisUtterance) => {
				spoken.push(utterance.text);
				window.setTimeout(
					() => utterance.onend?.(new Event("end") as SpeechSynthesisEvent),
					50
				);
			}) as typeof synth.speak;
		}
	});
	await seedChat(page, [
		{ role: "user", content: "Comment dit-on window en français ?" },
		{ role: "assistant", content: "On dit « fenêtre »." }
	]);
	await page.goto("/");
	await expect(page.locator(".send-btn")).toBeVisible({ timeout: 60_000 });
	await toggleSidebar(page);
	await page.locator("aside ul li .side-chat").first().hover();
	await page.keyboard.press("Shift+R");
	await expect
		.poll(() =>
			page.evaluate(() =>
				(window as unknown as { __spoken: string[] }).__spoken.join("|")
			)
		)
		.toContain("Comment dit-on window");
});

/** Picking a chat from a filtered list lands on the filter's first
match there and flashes it. */
test("a filtered pick flashes the match", async ({ page }) => {
	const filler = Array.from({ length: 12 }, (_, i) => ({
		role: (i % 2 ? "assistant" : "user") as "user" | "assistant",
		content: `Filler paragraph ${i}. `.repeat(20)
	}));
	await seedChat(page, [
		...filler,
		{ role: "assistant", content: "Am Ende: die Straße ist lang." },
		...filler.slice(0, 4)
	]);
	await page.goto("/");
	await expect(page.locator(".send-btn")).toBeVisible({ timeout: 60_000 });
	await toggleSidebar(page);
	await page.locator("aside .side-search").fill("strasse");
	await page.locator("aside ul li button.side-chat").first().click();
	const flashSize = (): Promise<number> =>
		page.evaluate(() => {
			const reg = (
				window.CSS as unknown as {
					highlights?: { get(n: string): { size: number } | undefined };
				}
			).highlights;
			return reg?.get("ccez-ann-flash")?.size ?? 0;
		});
	await expect.poll(flashSize, { timeout: 5_000 }).toBeGreaterThan(0);
	await page.waitForTimeout(300);
	await page.screenshot({ path: ".screenshots/filter-flash.png" });
	// The flashed words sit in view.
	const inView = await page.evaluate(() => {
		const p = [...document.querySelectorAll("article .rendered p")].find((el) =>
			el.textContent?.includes("Straße")
		);
		const r = p?.getBoundingClientRect();
		return !!r && r.top >= 0 && r.bottom <= window.innerHeight;
	});
	expect(inView).toBe(true);
});

/** A folded message's preview shows only its opening, so a match
further in has no words on screen to flash: a filtered pick landing
there tints the whole message instead. */
test("a filtered pick into a folded message pulses it", async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: "Wie sagt man street?" },
		{
			role: "assistant",
			content: `Kurz gesagt. ${"Noch ein Satz dazu. ".repeat(30)}Am Ende: die Straße ist lang.`
		}
	]);
	await page.goto("/");
	await expect(page.locator(".send-btn")).toBeVisible({ timeout: 60_000 });
	const article = page.locator("article.assistant").last();
	await article.hover();
	await article
		.locator('.actions button[aria-label="Fold this message"]')
		.click();
	await expect(article.locator(".folded-preview")).toBeVisible();
	await expect(article.locator(".folded-preview")).not.toContainText("Straße");
	await toggleSidebar(page);
	await page.locator("aside .side-search").fill("strasse");
	await page.locator("aside ul li button.side-chat").first().click();
	await expect(page.locator("article.landed")).toHaveCount(1, {
		timeout: 3_000
	});
});

/** Two long chats, the prompt always shown, and a reply that thinks
for a long while before its first token. */
async function seedThinkingPair(page: Page): Promise<void> {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem("ccez-mock-first-ms", "30000");
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ promptIdleSec: 0 })
		);
		const body = (tag: string) =>
			Array.from({ length: 40 }, (_, i) => `${tag} line ${i}`).join("\n\n");
		const chat = (id: string, createdAt: number, tag: string) => ({
			id,
			createdAt,
			replyLang: null,
			messages: [0, 1, 2, 3].map((i) => ({
				id: `${id}-m${i}`,
				role: i % 2 ? "assistant" : "user",
				content: i % 2 ? body(tag) : `${tag} question ${i}`,
				usage: null,
				error: null
			}))
		});
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([chat("e2e-a", 1, "Alpha"), chat("e2e-b", 2, "Beta")])
		);
	});
}

/** Leaving a thinking chat and coming back: the request is not sent
again, the count shows its true age, the box lands at the bottom
where the reply will appear, and each chat keeps its own unsent
prompt text. */
test("a thinking chat keeps its draft, age, and place across a switch", async ({
	page
}) => {
	await seedThinkingPair(page);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toContainText(
		"Alpha question",
		{ timeout: 60_000 }
	);
	const input = page.locator(".ta-input");
	await input.click();
	await page.keyboard.type("hello there");
	await page.keyboard.press("Enter");
	await expect(page.locator(".sending")).toBeVisible();
	await page.keyboard.type("draft for alpha");
	const elapsed = page.locator(".sending-elapsed");
	await expect(elapsed).toHaveText(/· [3-9]s/, { timeout: 10_000 });
	// Away: Beta's prompt is its own (empty), and gets its own draft.
	await page.keyboard.press("ControlOrMeta+Shift+J");
	await expect(page.locator("article .rendered").first()).toContainText(
		"Beta question"
	);
	await expect(input).toHaveValue("");
	await page.keyboard.type("draft for beta");
	await page.waitForTimeout(1200);
	// Back: Alpha's draft, the true age, and the bottom of the thread.
	await page.keyboard.press("ControlOrMeta+Shift+K");
	await expect(page.locator("article .rendered").first()).toContainText(
		"Alpha question"
	);
	await expect(input).toHaveValue("draft for alpha");
	await expect(elapsed).toHaveText(/· ([4-9]|\d\d)s/);
	const gap = await page
		.locator("main .messages")
		.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
	expect(gap).toBeLessThan(8);
	// Never resent: one request, one question, one pending reply.
	expect(
		await page.evaluate(
			() =>
				(window as unknown as { __ccezMockStreams?: number }).__ccezMockStreams
		)
	).toBe(1);
	await expect(page.locator("article")).toHaveCount(6);
	// And Beta still has its own.
	await page.keyboard.press("ControlOrMeta+Shift+J");
	await expect(input).toHaveValue("draft for beta");
});

/** ⇧⌘J onto an existing empty newest chat is a fresh chat too: the
prompt takes focus, never a visible but unfocused composer. */
test("shift-cmd-j onto an empty chat focuses the prompt", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{
					id: "e2e-full",
					createdAt: 1,
					replyLang: null,
					messages: [
						{
							id: "e2e-full-m0",
							role: "assistant",
							content: "full chat here",
							usage: null,
							error: null
						}
					]
				},
				{ id: "e2e-empty", createdAt: 2, replyLang: null, messages: [] }
			])
		);
	});
	await page.goto("/");
	await expect(page.locator("article .rendered")).toContainText(
		"full chat here",
		{ timeout: 60_000 }
	);
	await page.keyboard.press("Meta+Shift+J");
	await expect(page.locator(".hero")).toBeVisible({ timeout: 10_000 });
	await expect
		.poll(() =>
			page.evaluate(() => !!document.activeElement?.closest?.(".prompt"))
		)
		.toBe(true);
});

/** Shift on its own never peeks the chat counter (it flashed up on
every capital and Shift chord); ⇧⌘ held outside the prompt does. */
test("Shift alone never peeks the chat counter; Shift+Cmd does", async ({
	page
}) => {
	await seedThinkingPair(page);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toContainText(
		"Alpha question",
		{ timeout: 60_000 }
	);
	const counter = page.locator(".chat-counter");
	await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
	await page.keyboard.down("Shift");
	await page.waitForTimeout(500);
	await expect(counter).not.toHaveClass(/shown/);
	await page.keyboard.down("Meta");
	await expect(counter).toHaveClass(/shown/);
	await expect(counter).toHaveText("1 / 2");
	await page.keyboard.up("Meta");
	await expect(counter).not.toHaveClass(/shown/);
	await page.keyboard.up("Shift");
});

/** ⇧⌘ is the chat-stepping chord's base: holding it peeks the counter
even from the prompt, and it follows each ⇧⌘J/K step. */
test("holding Shift+Cmd in the prompt peeks the chat counter", async ({
	page
}) => {
	await seedThinkingPair(page);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toContainText(
		"Alpha question",
		{ timeout: 60_000 }
	);
	const counter = page.locator(".chat-counter");
	await page.locator(".ta-input").click();
	await page.keyboard.down("Shift");
	await page.keyboard.down("Meta");
	await expect(counter).toHaveClass(/shown/);
	await expect(counter).toHaveText("1 / 2");
	await page.keyboard.press("j");
	await expect(page.locator("article .rendered").first()).toContainText(
		"Beta question"
	);
	await expect(counter).toHaveText("2 / 2");
	await expect(counter).toHaveClass(/shown/);
	// Letting go of ⌘ in the prompt leaves a capital-letter Shift.
	await page.keyboard.up("Meta");
	await expect(counter).not.toHaveClass(/shown/);
	await page.keyboard.up("Shift");
});

/** The peek is quick and sticky: it lands within ~150 ms of ⇧⌘ going
down with a ~100 ms fade, and ⇧⌘ chords keep it up until a key is
released (or the window blurs). Timed in the page. */
test("Shift+Cmd peek shows fast and survives the chat steps", async ({
	page
}) => {
	await seedThinkingPair(page);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toContainText(
		"Alpha question",
		{ timeout: 60_000 }
	);
	const counter = page.locator(".chat-counter");
	await page.evaluate(() => {
		(document.activeElement as HTMLElement | null)?.blur();
		const el = document.querySelector(".chat-counter")!;
		const w = window as unknown as Record<string, number>;
		window.addEventListener(
			"keydown",
			(e) => {
				if (e.key === "Meta" && !e.repeat) w["__shiftAt"] = performance.now();
			},
			true
		);
		new MutationObserver(() => {
			if (el.classList.contains("shown") && !w["__shownAt"])
				w["__shownAt"] = performance.now();
		}).observe(el, { attributes: true, attributeFilter: ["class"] });
	});
	// It snaps: no fade either way.
	expect(
		await counter.evaluate((el) => getComputedStyle(el).transitionDuration)
	).toBe("0s");
	await page.keyboard.down("Shift");
	await page.keyboard.down("Meta");
	await expect(counter).toHaveClass(/shown/);
	expect(await counter.evaluate((el) => getComputedStyle(el).visibility)).toBe(
		"visible"
	);
	const shown = await page.evaluate(() => {
		const w = window as unknown as Record<string, number>;
		return w["__shownAt"]! - w["__shiftAt"]!;
	});
	expect(shown).toBeLessThan(200);
	// Chat steps keep it up, and it follows them.
	await page.keyboard.press("KeyJ");
	await page.waitForTimeout(300);
	await expect(counter).toHaveClass(/shown/);
	await expect(counter).toHaveText("2 / 2");
	await page.keyboard.up("Meta");
	await expect(counter).not.toHaveClass(/shown/);
	// Window blur hides it while the keys are still down.
	await page.keyboard.down("Meta");
	await expect(counter).toHaveClass(/shown/);
	await page.evaluate(() => window.dispatchEvent(new Event("blur")));
	await expect(counter).not.toHaveClass(/shown/);
	await page.keyboard.up("Meta");
	await page.keyboard.up("Shift");
});
