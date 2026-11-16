// Explicit import (never global `process`): see vite.config.js.
import process from "node:process";
import { expect, test, type Page } from "./fixtures";
import { seedChat, type SeedMessage } from "./helpers";

/**
 * DeepSeek's web search, end to end against a stand-in stream (never
 * the real API): the chat asks with DeepSeek's own web tools, the
 * reply lands with a row of site icons and "N sources", and tapping it
 * lists each search and each page. Sources saved with a reply render
 * on load too. `SOURCES_SHOTS_DIR` (local runs only) saves the phone
 * and desktop pictures there.
 */

const SHOTS = process.env["SOURCES_SHOTS_DIR"];
const FAKE_KEY = "sk-test-fake";

const SEARCH_1 = { type: "search", queries: ["Iceland population 2026"] };
const SEARCH_2 = {
	type: "search",
	queries: ["Statistics Iceland population forecast", "Reykjavik population"]
};
const OPEN = {
	type: "open_page",
	url: "https://statice.is/statistics/population/inhabitants/"
};
const SOURCES_1 = [
	{
		type: "url",
		url: "https://statice.is/statistics/population/inhabitants/",
		title: "Population of Iceland on 1 January 2026",
		snippet: "394,000 inhabitants",
		site_name: "Statistics Iceland",
		site_icon: "https://cdn.deepseek.com/site-icons/statice.is",
		published_at: "2026-03-20T00:00:00+00:00"
	},
	{
		type: "url",
		url: "https://en.wikipedia.org/wiki/Demographics_of_Iceland",
		title: "Demographics of Iceland",
		snippet: "Iceland has a population of about",
		site_name: "Wikipedia",
		site_icon: "https://cdn.deepseek.com/site-icons/wikipedia.org",
		published_at: null
	}
];
const SOURCES_2 = [
	{
		type: "url",
		url: "https://www.icelandreview.com/news/population-to-reach-half-a-million/",
		title: "Population to reach half a million within 25 years",
		snippet: "forecast",
		site_name: "Iceland Review",
		site_icon: "https://cdn.deepseek.com/site-icons/icelandreview.com",
		published_at: "2026-01-12T00:00:00+00:00"
	},
	{
		type: "url",
		url: "https://reykjavik.is/en/statistics",
		title: "https://reykjavik.is/en/statistics",
		snippet: "Reykjavik",
		site_name: null,
		site_icon: null,
		published_at: null
	}
];

const ANSWER =
	"Iceland has about **394,000** people (1 January 2026, Statistics Iceland). Its forecast puts the country at half a million within 25 years; about a third of everyone lives in Reykjavík.";

const STEPS = [
	{
		index: 0,
		reasoning_content: "Find the latest official figure.",
		calls: [
			{
				index: 0,
				id: "srvtoolu_ds_00_a",
				type: "deepseek_web_search",
				kind: "deep_search",
				action: SEARCH_1,
				status: "completed",
				sources: SOURCES_1
			}
		]
	},
	{
		index: 1,
		reasoning_content: "Check the forecast and the capital.",
		calls: [
			{
				index: 0,
				id: "srvtoolu_ds_01_a",
				type: "deepseek_web_search",
				kind: "deep_search",
				action: SEARCH_2,
				status: "completed",
				sources: SOURCES_2
			},
			{
				index: 1,
				id: "srvtoolu_ds_01_b",
				type: "deepseek_web_search",
				kind: "deep_search",
				action: OPEN,
				status: "completed",
				page: {
					url: OPEN.url,
					title: "Population of Iceland on 1 January 2026",
					published_at: null
				}
			}
		]
	}
];

function chunk(payload: unknown): string {
	return `data: ${JSON.stringify(payload)}\n\n`;
}

const toolEvent = (event: unknown) =>
	chunk({ choices: [{ index: 0, delta: {}, server_tool_event: event }] });

/** DeepSeek's stream for the question: two searches, a page, the answer. */
function deepSeekStream(): string {
	const parts = [
		chunk({
			choices: [
				{
					index: 0,
					delta: { reasoning_content: "Find the latest official figure." }
				}
			]
		}),
		toolEvent({ type: "step_reasoning_done", step: 0 }),
		toolEvent({
			type: "call_started",
			step: 0,
			call: { index: 0, action: SEARCH_1 }
		}),
		toolEvent({
			type: "call_completed",
			step: 0,
			call: {
				index: 0,
				action: SEARCH_1,
				status: "completed",
				sources: SOURCES_1
			}
		}),
		chunk({
			choices: [
				{
					index: 0,
					delta: { reasoning_content: "Check the forecast and the capital." }
				}
			]
		}),
		toolEvent({ type: "step_reasoning_done", step: 1 }),
		toolEvent({
			type: "call_started",
			step: 1,
			call: { index: 0, action: SEARCH_2 }
		}),
		toolEvent({
			type: "call_started",
			step: 1,
			call: { index: 1, action: OPEN }
		}),
		toolEvent({
			type: "call_completed",
			step: 1,
			call: {
				index: 0,
				action: SEARCH_2,
				status: "completed",
				sources: SOURCES_2
			}
		}),
		toolEvent({
			type: "call_completed",
			step: 1,
			call: {
				index: 1,
				action: OPEN,
				status: "completed",
				page: STEPS[1]!.calls[1]!.page
			}
		}),
		chunk({
			choices: [{ index: 0, delta: { reasoning_content: "Enough to answer." } }]
		})
	];
	for (const word of ANSWER.split(/(?<= )/))
		parts.push(chunk({ choices: [{ index: 0, delta: { content: word } }] }));
	parts.push(
		chunk({
			choices: [
				{
					index: 0,
					finish_reason: "stop",
					delta: {
						content: "",
						server_tool_calls: STEPS,
						annotations: [
							{
								type: "url_citation",
								url_citation: {
									url: SOURCES_1[0]!.url,
									title: SOURCES_1[0]!.title,
									start_index: 0,
									end_index: 40
								}
							}
						]
					}
				}
			],
			usage: { prompt_tokens: 1900, completion_tokens: 120, total_tokens: 2020 }
		}),
		"data: [DONE]\n\n"
	);
	return parts.join("");
}

/** A small round icon per site, standing in for DeepSeek's site icons. */
function icon(letter: string, color: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${color}"/><text x="16" y="22" font-family="Helvetica,Arial,sans-serif" font-size="17" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`;
}
const ICONS: Record<string, string> = {
	"statice.is": icon("S", "#1a5e9a"),
	"wikipedia.org": icon("W", "#3a3a3a"),
	"icelandreview.com": icon("IR", "#c8102e")
};

/** Keyed DeepSeek, the mock flag off (the real client path), no network:
 * DeepSeek and every icon answer from here. */
async function seedDeepSeek(
	page: Page,
	messages: SeedMessage[] = [],
	saved: Record<string, unknown>[] | null = null
): Promise<{ bodies: Array<Record<string, unknown>> }> {
	await seedChat(page, messages, null, {
		activeProviderId: "deepseek",
		providers: {
			deepseek: {
				baseUrl: "https://api.deepseek.com",
				apiKey: FAKE_KEY,
				model: "deepseek-flash",
				models: []
			}
		}
	});
	await page.addInitScript((chat: Record<string, unknown>[] | null) => {
		window.localStorage.removeItem("ccez-mock-provider");
		if (chat)
			window.localStorage.setItem(
				"ccez-llm-chats-v1",
				JSON.stringify([
					{ id: "e2e-chat", createdAt: 1, replyLang: null, messages: chat }
				])
			);
	}, saved);
	const bodies: Array<Record<string, unknown>> = [];
	await page.route("https://api.deepseek.com/**", async (route) => {
		if (route.request().method() !== "POST")
			return route.fulfill({ json: { data: [{ id: "deepseek-flash" }] } });
		bodies.push(route.request().postDataJSON() as Record<string, unknown>);
		return route.fulfill({
			status: 200,
			headers: { "content-type": "text/event-stream" },
			body: deepSeekStream()
		});
	});
	await page.route("https://cdn.deepseek.com/site-icons/**", (route) => {
		const site = new URL(route.request().url()).pathname.split("/").pop() ?? "";
		const svg = ICONS[site];
		return svg
			? route.fulfill({ contentType: "image/svg+xml", body: svg })
			: route.fulfill({ status: 404, body: "" });
	});
	// Sites' own favicons: none here, so the row falls back to a letter.
	await page.route(/\/favicon\.ico$/, (route) =>
		route.fulfill({ status: 404, body: "" })
	);
	return { bodies };
}

async function ask(page: Page, text: string): Promise<void> {
	await page.locator(".ta-input").first().click();
	await page.keyboard.type(text);
	await page.keyboard.press("Enter");
}

test("a DeepSeek answer lists what it looked up", async ({ page }) => {
	const { bodies } = await seedDeepSeek(page);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({
		timeout: 60_000
	});
	await ask(page, "How many people live in Iceland?");
	const reply = page.locator("article.assistant").last();
	await expect(reply.locator(".rendered")).toContainText("394,000", {
		timeout: 30_000
	});
	// The chat asked with DeepSeek's own web tools and low thinking.
	expect(bodies[0]).toMatchObject({
		model: "deepseek-flash",
		thinking: { type: "enabled" },
		reasoning_effort: "low",
		tools: [{ type: "deepseek_web_search" }, { type: "deepseek_read_url" }]
	});
	expect(JSON.stringify(bodies[0]?.["tools"])).not.toContain("fetch_url");
	// Its system line names no tool it doesn't have.
	expect(JSON.stringify(bodies[0]?.["messages"])).not.toContain("fetch_url");
	const row = reply.locator(".sources-row");
	await expect(row).toContainText("4 sources");
	await expect(row.locator(".site-icon")).toHaveCount(4);
	await expect(row).toHaveAttribute("aria-expanded", "false");
	await row.click();
	const list = reply.locator(".sources-list");
	await expect(list).toBeVisible();
	await expect(list.locator(".searches li")).toHaveCount(2);
	await expect(list.locator(".query")).toHaveText([
		"Iceland population 2026",
		"Statistics Iceland population forecast",
		"Reykjavik population"
	]);
	const links = list.locator(".pages a");
	await expect(links).toHaveCount(4);
	// The cited page first; each opens in a new tab.
	await expect(links.first()).toHaveAttribute("href", SOURCES_1[0]!.url);
	await expect(links.first()).toContainText("Statistics Iceland");
	for (const link of await links.all()) {
		await expect(link).toHaveAttribute("target", "_blank");
		await expect(link).toHaveAttribute("rel", /noopener/);
	}
	// A title that was only the address reads as the site.
	await expect(list.locator(".pages li").last()).toContainText("reykjavik.is");
	await expect(list.locator(".pages li .site").last()).toHaveText(
		"reykjavik.is/en/statistics"
	);
	await expect(list.locator(".pages li .site").first()).toHaveText(
		"Statistics Iceland · statice.is"
	);
	// Kept with the chat (a reload rebuilds the row from this).
	const saved = await page.evaluate(
		() => window.localStorage.getItem("ccez-llm-chats-v1") ?? ""
	);
	expect(saved).toContain("srvtoolu_ds_01_b");
	expect(saved).not.toContain(FAKE_KEY);
	await row.click();
	await expect(list).toBeHidden();
});

test("sources saved with a reply show after a reload, on a phone", async ({
	browser
}) => {
	const ctx = await browser.newContext({
		viewport: { width: 390, height: 844 },
		deviceScaleFactor: 3,
		isMobile: true,
		hasTouch: true,
		userAgent:
			"Mozilla/5.0 (Linux; Android 16; SM-S921U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36"
	});
	const page = await ctx.newPage();
	try {
		await seedDeepSeek(
			page,
			[],
			[
				{
					id: "e2e-m0",
					role: "user",
					content: "How many people live in Iceland?",
					usage: null,
					error: null
				},
				{
					id: "e2e-m1",
					role: "assistant",
					content: ANSWER,
					usage: null,
					error: null,
					reasoning: "Enough to answer.",
					webCalls: STEPS,
					webCited: [SOURCES_1[0]!.url]
				}
			]
		);
		await page.goto("/");
		const reply = page.locator("article.assistant").last();
		await expect(reply.locator(".rendered")).toContainText("394,000", {
			timeout: 60_000
		});
		const row = reply.locator(".sources-row");
		await expect(row).toContainText("4 sources");
		// Fits the phone: nothing wider than the screen.
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - window.innerWidth
		);
		expect(overflow).toBeLessThanOrEqual(0);
		await row.tap();
		const list = reply.locator(".sources-list");
		await expect(list.locator(".pages a")).toHaveCount(4);
		const box = await list.boundingBox();
		expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
		if (SHOTS) {
			await page.waitForTimeout(400);
			await reply.locator(".sources-row").scrollIntoViewIfNeeded();
			await page.screenshot({ path: `${SHOTS}/ccez-llm-sources-phone.png` });
		}
	} finally {
		await ctx.close();
	}
});

test("desktop picture of the sources", async ({ page }) => {
	test.skip(!SHOTS, "pictures only when asked for");
	await page.setViewportSize({ width: 1280, height: 860 });
	await seedDeepSeek(
		page,
		[],
		[
			{
				id: "e2e-m0",
				role: "user",
				content: "How many people live in Iceland?",
				usage: null,
				error: null
			},
			{
				id: "e2e-m1",
				role: "assistant",
				content: ANSWER,
				usage: null,
				error: null,
				webCalls: STEPS,
				webCited: [SOURCES_1[0]!.url]
			}
		]
	);
	await page.goto("/");
	const reply = page.locator("article.assistant").last();
	await expect(reply.locator(".rendered")).toContainText("394,000", {
		timeout: 60_000
	});
	await reply.locator(".sources-row").click();
	await expect(reply.locator(".sources-list .pages a")).toHaveCount(4);
	await page.waitForTimeout(400);
	await page.screenshot({ path: `${SHOTS}/ccez-llm-sources-desktop.png` });
	await page.emulateMedia({ colorScheme: "dark" });
	await page.waitForTimeout(300);
	await page.screenshot({ path: `${SHOTS}/ccez-llm-sources-desktop-dark.png` });
});
