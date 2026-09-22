import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

test.describe("voice-data", () => {
	/**
	 * Voice + data bucket (user-visible surface):
	 * - The Study-fonts inventory and the Lesson-audio export are both
	 *   removed from settings (lesson-audio froze the app).
	 * - The composer still accepts attachments (pdf/docx inline as text
	 *   via the offline extractors; covered at unit level).
	 */
	test.beforeEach(async ({ page }) => {
		await seedChat(page, [
			{ role: "assistant", content: "你好，let us study" }
		]);
		await page.goto("/");
		await expect(page.locator("article.assistant")).toBeVisible({
			timeout: 60_000
		});
	});

	test("settings show no study-fonts or lesson-audio sections", async ({
		page
	}) => {
		await page.keyboard.press("Meta+,");
		const panel = page.locator(".settings-panel");
		await expect(panel).not.toHaveClass(/closed/);
		await expect(panel.getByText("Study fonts", { exact: true })).toHaveCount(
			0
		);
		await expect(
			panel.getByRole("button", { name: "Check fonts again" })
		).toHaveCount(0);
		await expect(panel.getByText("Lesson audio", { exact: true })).toHaveCount(
			0
		);
		await expect(
			panel.getByRole("button", { name: "Save sample audio" })
		).toHaveCount(0);
	});
});

test.describe("voice-error", () => {
	/** Lab speech never fails at runtime (utterances queue silently), so these
	specs stub `speak` to throw: `speakMultilingual` catches it and reports
	false, which deterministically drives the unavailable-voice paths. */
	async function throwingSpeak(
		page: Parameters<typeof seedChat>[0]
	): Promise<void> {
		await page.addInitScript(() => {
			const synth = window.speechSynthesis;
			if (!synth) return;
			Object.defineProperty(synth, "speak", {
				value: () => {
					throw new Error("stubbed speech failure");
				},
				configurable: true
			});
		});
	}

	async function webEngine(
		page: Parameters<typeof seedChat>[0]
	): Promise<void> {
		await page.addInitScript(() => {
			window.localStorage.setItem("ccez-mock-provider", "1");
			window.localStorage.setItem(
				"ccez-llm-settings-v1",
				JSON.stringify({ voiceEngine: "web" })
			);
		});
	}

	test("explicit speak failure banners, then expires", async ({ page }) => {
		await throwingSpeak(page);
		await webEngine(page);
		// Tall enough that the article's hover center clears the
		// invisible top drag strip (a one-liner would sit under it).
		await seedChat(page, [
			{
				role: "assistant",
				content:
					"hello there\n\nlorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor"
			}
		]);
		await page.goto("/");
		const article = page.locator("article.assistant");
		await expect(article).toBeVisible({ timeout: 60_000 });
		await article.hover();
		await article
			.locator('button[aria-label="Read this message aloud"]')
			.click();
		const toast = page.locator(".voice-error");
		await expect(toast).toBeVisible();
		await expect(toast).toBeHidden({ timeout: 20_000 });
	});

	test("background readback failure stays silent", async ({ page }) => {
		await throwingSpeak(page);
		await page.addInitScript(() => {
			window.localStorage.setItem("ccez-mock-provider", "1");
			// NOTE: voice itself can't be seeded — every boot resets it to
			// false by design, so the test enables it post-boot below. Only
			// the engine survives seeding.
			window.localStorage.setItem(
				"ccez-llm-settings-v1",
				JSON.stringify({ voiceEngine: "web" })
			);
			// Count every banner appearance: the failure banner auto-expires,
			// so a final absence proves nothing — only "never shown" does.
			// Deferred past document readiness (init scripts can run before
			// documentElement exists); the spec asserts the ready flag.
			window.voiceToastSeen = 0;
			window.voiceToastWatching = false;
			const watch = (): void => {
				if (!document.documentElement) {
					requestAnimationFrame(watch);
					return;
				}
				new MutationObserver((mutations) => {
					for (const m of mutations) {
						for (const n of m.addedNodes) {
							if (n instanceof Element && n.classList.contains("voice-error")) {
								window.voiceToastSeen++;
							}
						}
					}
				}).observe(document.documentElement, {
					childList: true,
					subtree: true
				});
				window.voiceToastWatching = true;
			};
			watch();
		});
		await page.goto("/");
		// Readback on, through the same toggle a user would press.
		await expect
			.poll(
				async () => page.evaluate(() => window.voiceToastWatching === true),
				{ timeout: 10_000 }
			)
			.toBe(true);
		// Readback on, through the same toggle a user would press.
		await page.locator(".prompt-tools .voice-float").click();
		await expect(page.locator(".prompt-tools .voice-float")).toHaveAttribute(
			"aria-pressed",
			"true"
		);
		await page.locator(".prompt .ta-input").click();
		await page.keyboard.type("say hi");
		await page.keyboard.press("Enter");
		await expect(page.locator("article.assistant .rendered")).toBeVisible({
			timeout: 60_000
		});
		// Past the reply and any failure banner's full auto-expiry.
		await page.waitForTimeout(12_000);
		const seen = await page.evaluate(() => window.voiceToastSeen ?? -1);
		expect(seen).toBe(0);
	});
});

test.describe("native-fallback", () => {
	/**
	 * Platform-parity fallback (Windows/Linux native TTS + Linux dictation):
	 * the new Rust commands only exist inside the Tauri shell, so the
	 * browser preview must behave exactly as before — web-voices fieldset
	 * in settings, per-message Speak offered, no native UI leaking in.
	 * (Shell-side speech itself is device-only and unverified here.)
	 */
	test.beforeEach(async ({ page }) => {
		// Tall enough that the article's hover center clears the
		// invisible top drag strip (a one-liner would sit under it).
		await seedChat(page, [
			{
				role: "assistant",
				content:
					"hello there\n\nlorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor"
			}
		]);
		await page.goto("/");
		await expect(page.locator("article.assistant")).toBeVisible({
			timeout: 60_000
		});
	});

	test("browser settings show the web-voices engine note, not the system picker", async ({
		page
	}) => {
		await page.keyboard.press("Meta+,");
		const panel = page.locator(".settings-panel");
		await expect(panel).not.toHaveClass(/closed/);
		await expect(
			panel.getByText("browser preview can only use web voices")
		).toBeVisible();
		await expect(
			panel.locator('select[aria-labelledby="system-voice-label"]')
		).toHaveCount(0);
	});

	test("assistant messages still offer read-aloud without a native bridge", async ({
		page
	}) => {
		const article = page.locator("article.assistant");
		await article.hover();
		await expect(
			article.locator('button[aria-label="Read this message aloud"]')
		).toBeVisible();
	});
});

test.describe("ios-voice", () => {
	/** iPhone Safari UA: rides the same phone UI as Android (see isIOSUserAgent). */
	const IPHONE_UA =
		"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

	/** iOS-side inventory has no premium/enhanced tiers (all quality ≤ 1). */
	const IOS_VOICES = [
		{
			id: "com.apple.ttsbundle.Samantha-compact",
			name: "Samantha",
			lang: "en-US",
			quality: 1
		},
		{
			id: "com.apple.ttsbundle.Daniel-compact",
			name: "Daniel",
			lang: "en-GB",
			quality: 1
		},
		{
			id: "com.apple.ttsbundle.Marie-compact",
			name: "Marie",
			lang: "fr-FR",
			quality: 1
		}
	];

	test.use({
		userAgent: IPHONE_UA,
		hasTouch: true,
		isMobile: true,
		viewport: { width: 390, height: 844 }
	});

	/** Stub the Tauri bridge: native engine present, everything else absent. */
	async function iosBridge(
		page: Parameters<typeof seedChat>[0]
	): Promise<void> {
		await page.addInitScript((voices: typeof IOS_VOICES) => {
			(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
				invoke: async (cmd: string) => {
					if (cmd === "tts_supported") return true;
					if (cmd === "tts_voices") return voices;
					throw new Error(`unmocked command: ${cmd}`);
				}
			};
		}, IOS_VOICES);
	}

	test.beforeEach(async ({ page }) => {
		await iosBridge(page);
		await seedChat(page, [{ role: "user", content: "hi" }]);
		await page.goto("/");
		await expect(page.locator("article.user")).toBeVisible({ timeout: 60_000 });
		await page.keyboard.press("Meta+,");
		await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
	});

	/** iPhone UA activates the phone UI (textarea composer, no hover row). */
	test("iphone rides the phone ui", async ({ page }) => {
		await expect(page.locator("[data-android]")).toHaveCount(1);
		await expect(
			page
				.locator(".settings-panel")
				.getByText("Show message buttons only when tapped")
		).toBeVisible();
	});

	/** Both message checkboxes share one Messages box (no awkward gap). */
	test("message toggles grouped in one fieldset", async ({ page }) => {
		const box = page.locator(".settings-panel fieldset", {
			hasText: "only when tapped"
		});
		await expect(box.locator("legend")).toHaveText("Messages");
		await expect(
			box.getByText("Show message buttons only when tapped")
		).toBeVisible();
		await expect(
			box.getByText("Enable background on my messages")
		).toBeVisible();
	});

	/** The voice picker lists every installed voice (no quality gate on iOS). */
	test("ios voice picker lists installed voices", async ({ page }) => {
		const pick = page.locator(".settings-panel .voice-pick");
		await expect(pick.getByText("System voice (en-US)")).toBeVisible();
		// Scope past the Voice-language picker: phones carry two
		// .voice-pick blocks (language, then system voice).
		const select = page.locator(
			'.settings-panel .voice-pick select[aria-labelledby="system-voice-label-android"]'
		);
		await expect(select.locator("option").nth(1)).toHaveText("Samantha");
		await expect(select.locator("option").nth(2)).toHaveText("Daniel · en-GB");
	});

	/** Refresh is an icon on the picker row, and it reports its outcome. */
	test("voice refresh reports up to date", async ({ page }) => {
		const panel = page.locator(".settings-panel");
		const refresh = panel.getByRole("button", { name: "Check for new voices" });
		await expect(refresh).toBeVisible();
		await expect(refresh).toHaveText("");
		await expect(refresh.locator("svg")).toHaveCount(1);
		// Ghost icon: fixed square, transparent in every theme.
		const box = await refresh.boundingBox();
		expect(box).toBeTruthy();
		expect(Math.abs(box!.width - box!.height)).toBeLessThan(1);
		await expect
			.poll(() =>
				refresh.evaluate((el) => getComputedStyle(el).backgroundColor)
			)
			.toBe("rgba(0, 0, 0, 0)");
		await refresh.click();
		await expect(panel.getByText("Voice list is up to date.")).toBeVisible();
	});

	/** A picked voice is saved (debounced) and restored on boot. */
	test("ios voice pick persists", async ({ page }) => {
		const select = page.locator(
			'.settings-panel .voice-pick select[aria-labelledby="system-voice-label-android"]'
		);
		await select.selectOption("com.apple.ttsbundle.Daniel-compact");
		// Settings autosave debounces: let the pick land, then prove the save.
		await page.waitForTimeout(700);
		const saved = await page.evaluate(() =>
			window.localStorage.getItem("ccez-llm-settings-v1")
		);
		expect(saved).toContain("com.apple.ttsbundle.Daniel-compact");
		// Reload with a stored pick (addInitScript re-seeds every navigation,
		// so plain reload would wipe it like a fresh install): the picker
		// restores it instead of resetting to Auto.
		await page.addInitScript(() => {
			const raw = window.localStorage.getItem("ccez-llm-settings-v1") ?? "{}";
			const settings = JSON.parse(raw) as Record<string, unknown>;
			settings.nativeVoiceId = "com.apple.ttsbundle.Daniel-compact";
			window.localStorage.setItem(
				"ccez-llm-settings-v1",
				JSON.stringify(settings)
			);
		});
		await page.reload();
		await expect(page.locator("article.user")).toBeVisible({ timeout: 60_000 });
		await page.keyboard.press("Meta+,");
		await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
		await expect(
			page.locator(
				'.settings-panel .voice-pick select[aria-labelledby="system-voice-label-android"]'
			)
		).toHaveValue("com.apple.ttsbundle.Daniel-compact");
	});
});
