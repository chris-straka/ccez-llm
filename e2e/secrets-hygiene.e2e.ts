import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Secrets hygiene: a typed provider key must never leak outside the
 * settings entry (browser builds persist it there by design — see
 * `saveSettingsNow`), and the Keychain-fallback mirror must hold
 * ciphertext (`gcm1:` envelope), never the raw key.
 */

const RAW = "sk-e2e-hygiene-PROBE-9f8c";
const SETTINGS_KEY = "ccez-llm-settings-v1";
const MIRROR_KEY = "ccez-keychain:provider:muse";

test.beforeEach(async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
});

async function typeKey(page: import("@playwright/test").Page): Promise<void> {
	await page.keyboard.press("Meta+,");
	const panel = page.locator(".settings-panel");
	await expect(panel).not.toHaveClass(/closed/);
	const keyField = panel.locator('input[type="password"]');
	if ((await keyField.count()) === 0) {
		await panel.getByRole("button", { name: "Replace" }).click();
	}
	await keyField.fill(RAW);
	// persistSecrets + saveSettings run async after the edit: the
	// Keychain-fallback mirror landing proves the save completed.
	await expect
		.poll(async () => page.evaluate((k) => window.localStorage.getItem(k), MIRROR_KEY), {
			timeout: 15_000
		})
		.not.toBeNull();
	await page.keyboard.press("Escape");
}

test("typed key never appears outside settings storage", async ({ page }) => {
	await typeKey(page);
	const leaks = await page.evaluate(
		({ raw, allow }: { raw: string; allow: string[] }) => {
			const hits: string[] = [];
			for (let i = 0; i < window.localStorage.length; i++) {
				const k = window.localStorage.key(i);
				if (!k || allow.includes(k)) continue;
				if ((window.localStorage.getItem(k) ?? "").includes(raw)) hits.push(k);
			}
			return hits;
		},
		{ raw: RAW, allow: [SETTINGS_KEY] }
	);
	expect(leaks).toEqual([]);
});

test("keychain-fallback mirror holds ciphertext, not the raw key", async ({ page }) => {
	await typeKey(page);
	const mirror = await page.evaluate((k) => window.localStorage.getItem(k), MIRROR_KEY);
	expect(mirror).not.toBeNull();
	expect(mirror).not.toContain(RAW);
	expect(mirror!.startsWith("gcm1:")).toBe(true);
});

test("provider key never lands in persisted chat history", async ({ page }) => {
	// Seed the key the way a browser build persists it (plaintext in the
	// settings entry), then exercise a full send + reload cycle.
	await page.evaluate(
		({ raw }: { raw: string }) => {
			const stored = window.localStorage.getItem("ccez-llm-settings-v1");
			const parsed = stored ? (JSON.parse(stored) as Record<string, unknown>) : {};
			parsed["activeProviderId"] = "muse";
			parsed["providers"] = {
				...((parsed["providers"] as Record<string, unknown> | undefined) ?? {}),
				muse: {
					baseUrl: "https://api.meta.ai/v1",
					apiKey: raw,
					model: "muse-spark-1.3-contributor",
					models: []
				}
			};
			window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify(parsed));
		},
		{ raw: RAW }
	);
	// NOTE: no reload here — beforeEach's seedChat init script re-runs on
	// every navigation and would restore the seed. The storage entry IS
	// the persisted history; asserting on it directly is the honest check
	// (genuine reload cycles live in persistence-reload.e2e.ts).
	await page.locator(".cm-content").click();
	await page.keyboard.type("history hygiene check");
	await page.keyboard.press("Enter");
	await expect(page.locator("article.assistant .rendered")).toContainText("Mock reply to:", {
		timeout: 15_000
	});
	const history = await page.evaluate(
		(k) => window.localStorage.getItem(k) ?? "",
		"ccez-llm-chats-v1"
	);
	expect(history).not.toContain(RAW);
	expect(history).toContain("history hygiene check");
});
