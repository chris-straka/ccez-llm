import { expect, test } from "./fixtures";
import { seedChat } from "./helpers";

const REPLY =
	"Trotzdem hat die Regierung es gestern beschlossen, und alle waren darüber sehr überrascht.";

test("Learning words in a reply are underlined, read once, and a tap is a miss", async ({
	page
}) => {
	const seen: Array<{ word: string; tapped: boolean }> = [];
	const cors = {
		"access-control-allow-origin": "*",
		"access-control-allow-headers": "content-type",
		"access-control-allow-methods": "GET, POST"
	};
	await page.route("https://words.test/**", async (route) => {
		const req = route.request();
		const url = new URL(req.url());
		if (req.method() === "OPTIONS")
			return route.fulfill({ status: 204, headers: cors });
		if (url.pathname === "/words" && req.method() === "GET")
			return route.fulfill({
				headers: cors,
				json: {
					words: [
						{ lang: "de", word: "trotzdem", status: "learning" },
						{ lang: "de", word: "beschließen", status: "learning" }
					],
					seq: 1
				}
			});
		if (url.pathname === "/review")
			return route.fulfill({ headers: cors, json: { cards: {} } });
		if (url.pathname === "/headwords") {
			const body = req.postDataJSON() as { words: string[] };
			const out: Record<string, string | null> = {};
			for (const w of body.words)
				out[w] = w === "beschlossen" ? "beschließen" : null;
			return route.fulfill({ headers: cors, json: out });
		}
		if (url.pathname === "/review/seen") {
			seen.push(
				...(req.postDataJSON() as Array<{ word: string; tapped: boolean }>)
			);
			return route.fulfill({ status: 204, headers: cors });
		}
		return route.fulfill({ status: 204, headers: cors });
	});
	await seedChat(page, [], "de");
	await page.addInitScript((reply: string) => {
		localStorage.setItem("ccez-words-server", "https://words.test");
		localStorage.setItem("ccez-mock-word-ms", "10");
		localStorage.setItem("ccez-mock-reply", reply);
	}, REPLY);
	await page.goto("/");
	await expect(page.locator(".hero")).toBeVisible({ timeout: 60_000 });
	await page.locator(".ta-input").click();
	await page.keyboard.type("Was hat die Regierung gestern gemacht?");
	await page.keyboard.press("Enter");
	const marks = page.locator("article.assistant .rendered .ccez-learning");
	await expect(marks).toHaveCount(2, { timeout: 20_000 });
	await expect(marks.nth(0)).toHaveText("Trotzdem");
	await expect(marks.nth(1)).toHaveText("beschlossen");
	await page
		.locator("article.assistant")
		.screenshot({ path: "test-results/learning-underline.png" });
	// Read once: a pass for each, under its headword.
	await expect
		.poll(() =>
			seen
				.filter((s) => !s.tapped)
				.map((s) => s.word)
				.sort()
		)
		.toEqual(["beschließen", "trotzdem"]);
	// A tap: a miss.
	await marks.nth(0).click();
	await expect
		.poll(() => seen.filter((s) => s.tapped).map((s) => s.word))
		.toEqual(["trotzdem"]);
});
