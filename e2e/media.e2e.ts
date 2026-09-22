import { expect, test, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Study-session media (media bucket), stub-observed: the browser lab
 * has no haptics, wake locks, or notification tray, so specs install
 * recording stubs and assert the page calls them at the right moment.
 * Pure gating (long-reply threshold, VAD machine, waveform taper) is
 * pinned by colocated Vitest in src/lib/studyMedia.test.ts; the
 * live waveform/VAD dictation graph is device-only and unverified
 * here (see the follow-up note in the voice-bar spec).
 */

async function stubVibrate(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const calls: Array<number | number[]> = [];
		(window as unknown as Record<string, unknown>).__vibrateCalls = calls;
		// Notification stays denied so the send gesture never raises a
		// real permission prompt while asserting haptics.
		const denied = { permission: "denied" };
		Object.defineProperty(window, "Notification", {
			value: denied,
			configurable: true
		});
		Object.defineProperty(window.navigator, "vibrate", {
			value: (pattern: number | number[]) => {
				calls.push(pattern);
				return true;
			},
			configurable: true
		});
	});
}

async function vibrateCalls(page: Page): Promise<Array<number | number[]>> {
	return page.evaluate(
		() =>
			(window as unknown as { __vibrateCalls?: Array<number | number[]> })
				.__vibrateCalls ?? []
	);
}

async function sendHello(page: Page): Promise<void> {
	await page.locator(".ta-input").click();
	await page.keyboard.type("hello");
	await page.keyboard.press("Enter");
	await expect(page.locator("article.user .rendered")).toContainText("hello");
}

test("sending ticks haptics", async ({ page }) => {
	await stubVibrate(page);
	await seedChat(page, []);
	await page.goto("/");
	await page.locator(".ta-input").first().waitFor({ timeout: 60_000 });
	await sendHello(page);
	// Beat vocabulary (see HAPTIC_PATTERNS): send tap, first-token
	// rumble, stream-done thump.
	await expect
		.poll(() => vibrateCalls(page), { timeout: 15_000 })
		.toEqual([[20], [70], [35, 60, 110]]);
});

test("annotate ticks haptics and opens the pill", async ({ page }) => {
	await stubVibrate(page);
	await seedChat(page, [{ role: "assistant", content: "hello there" }]);
	await page.goto("/");
	const body = page.locator("article .rendered").first();
	await expect(body).toBeVisible({ timeout: 60_000 });
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	// The dev shell flashes a bridge-error toast on load that overlaps
	// the menu: real users wait it out, so the clicking tests do too.
	await page
		.locator(".toast")
		.waitFor({ state: "hidden", timeout: 15000 })
		.catch(() => {});
	await page.mouse.dblclick(box.x + 20, box.y + box.height / 2);
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await expect(page.locator(".ann-pop")).toBeVisible();
	expect(await vibrateCalls(page)).toEqual([6]);
});

test("read-aloud requests a screen wake lock", async ({ page }) => {
	await page.addInitScript(() => {
		const requests: string[] = [];
		(window as unknown as Record<string, unknown>).__wakeRequests = requests;
		Object.defineProperty(window.navigator, "wakeLock", {
			value: {
				request: (type: string) => {
					requests.push(type);
					return Promise.resolve({ release: () => {} });
				}
			},
			configurable: true
		});
	});
	await seedChat(page, [{ role: "assistant", content: "hello there" }]);
	await page.goto("/");
	const article = page.locator("article.assistant");
	await expect(article).toBeVisible({ timeout: 60_000 });
	await article.hover();
	await article.locator('button[aria-label="Read this message aloud"]').click();
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(window as unknown as { __wakeRequests?: string[] }).__wakeRequests ??
					[]
			)
		)
		.toEqual(["screen"]);
});

test("short backgrounded reply stays silent (no notification, no badge)", async ({
	page
}) => {
	await page.addInitScript(() => {
		const notes: unknown[] = [];
		(window as unknown as Record<string, unknown>).__notes = notes;
		const permRequests: unknown[] = [];
		(window as unknown as Record<string, unknown>).__permRequests =
			permRequests;
		class StubNotification {
			static permission = "default";
			static requestPermission(): Promise<string> {
				permRequests.push(1);
				return Promise.resolve("granted");
			}
			constructor(
				public title: string,
				public options?: { body?: string }
			) {
				notes.push({ title, options });
			}
		}
		Object.defineProperty(window, "Notification", {
			value: StubNotification,
			configurable: true
		});
		const badges: number[] = [];
		(window as unknown as Record<string, unknown>).__badges = badges;
		Object.defineProperty(window.navigator, "setAppBadge", {
			value: (count?: number) => {
				badges.push(count ?? 1);
				return Promise.resolve();
			},
			configurable: true
		});
	});
	await seedChat(page, []);
	await page.goto("/");
	await page.locator(".ta-input").first().waitFor({ timeout: 60_000 });
	// Background the window after boot: the mock reply is short, so a
	// correct gate stays silent even here (long-reply firing is pinned
	// by unit tests on shouldNotifyReplyDone).
	await page.evaluate(() => {
		Object.defineProperty(document, "hidden", {
			value: true,
			configurable: true
		});
		Object.defineProperty(document, "hasFocus", {
			value: () => false,
			configurable: true
		});
	});
	await sendHello(page);
	// Wait out the mock stream, then assert nothing pinged.
	await expect(page.locator("article.assistant .rendered")).toContainText(
		"Mock reply"
	);
	await page.waitForTimeout(500);
	const notes = await page.evaluate(
		() => (window as unknown as { __notes?: unknown[] }).__notes ?? []
	);
	expect(notes).toEqual([]);
	// Exactly one permission prompt, from the startup ask: the send
	// gesture never raises anything notification-shaped (with the old
	// send-time ask this would be two).
	const permRequests = await page.evaluate(
		() =>
			(window as unknown as { __permRequests?: unknown[] }).__permRequests ??
			[]
	);
	expect(permRequests).toEqual([1]);
});
