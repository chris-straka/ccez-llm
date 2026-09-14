import { test, expect } from "@playwright/test";

test("mic toggle hides prompt mic button", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify({}));
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([{ id: "e2e-chat", createdAt: 1, replyLang: null, messages: [] }])
		);
	});
	await page.goto("/");
	const hasRecognition = await page.evaluate(
		() => !!(window.SpeechRecognition || window.webkitSpeechRecognition)
	);
	console.log("recognition", hasRecognition);
	test.skip(!hasRecognition, "no speech recognition in this browser");
	await expect(page.locator(".prompt .mic-btn")).toBeVisible();
	await page.evaluate(() => {
		const raw = JSON.parse(window.localStorage.getItem("ccez-llm-settings-v1") || "{}");
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ ...raw, micEnabled: false })
		);
		window.location.reload();
	});
	await expect(page.locator(".prompt .mic-btn")).toHaveCount(0);
});
