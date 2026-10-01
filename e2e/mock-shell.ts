import type { Page } from "@playwright/test";

/**
 * Mock Tauri shell bridge for e2e: installs `__TAURI_INTERNALS__`
 * before the app boots, so shell-gated news transport runs past
 * `needs-shell` in headless chromium. Only `fetch_page` (mock
 * RSS + bare article HTML) and `news_decode_url` carry fixtures;
 * every other command fails loud, except the launch-time calls
 * the app already tolerates failing (keychain, event listen).
 */

/** First mock headline (ships a feed image, renders an <img>). */
export const MOCK_TITLE_IMG = "Tour Eiffel sparrows learn the Marseillaise";
/** Second mock headline (imageless: the miss settles to a tile). */
export const MOCK_TITLE_MISS = "Bakeries declare a croissant emergency across Lyon";
export const MOCK_SOURCE_MISS = "Gazette de Lyon";

/** Two-item Google-shaped feed: titles read "Headline - Outlet". */
export const MOCK_NEWS_RSS =
	`<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">` +
	`<channel><title>mock feed</title>` +
	`<item><title>${MOCK_TITLE_IMG} - Le Moqueur</title>` +
	`<link>https://news.google.com/rss/articles/mock-sparrows?oc=1</link>` +
	`<description>A feathered choir takes the tower.</description>` +
	`<media:thumbnail url="data:image/gif;base64,R0lGODlhAQABAIAAAP///////yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" width="16"/>` +
	`</item>` +
	`<item><title>${MOCK_TITLE_MISS} - ${MOCK_SOURCE_MISS}</title>` +
	`<link>https://news.google.com/rss/articles/mock-croissant?oc=1</link>` +
	`<description>Butter stocks run low as queues grow.</description>` +
	`</item></channel></rss>`;

/** Decoded article page: prose but no og:image (miss path). */
const MOCK_ARTICLE_HTML =
	`<html><head><title>mock article</title></head>` +
	`<body><article><h1>Mock article</h1>` +
	`<p>Butter stocks run low as queues grow around every corner bakery in the old town.</p>` +
	`<p>Bakers blame the sparrows, who blame the tourists, who keep buying croissants.</p>` +
	`</article></body></html>`;

export async function seedMockShell(page: Page): Promise<void> {
	await page.addInitScript(
		(seed: { rss: string; article: string }) => {
			const decode = (link: string): string => {
				const slug =
					link.split("/").pop()?.split("?")[0]?.trim() || "story";
				return `https://example.com/articles/${slug}`;
			};
			const shell = {
				invoke: async (
					cmd: string,
					args: Record<string, unknown>
				): Promise<unknown> => {
					if (cmd === "fetch_page") {
						const url = String(args["url"] ?? "");
						if (url.includes("news.google.com/rss")) return seed.rss;
						// Reader leg always walls: the miss settles, never retries.
						if (url.startsWith("https://r.jina.ai/"))
							throw new Error("bad-status:404");
						if (url.startsWith("https://example.com/articles/"))
							return seed.article;
						throw new Error("bad-status:404");
					}
					if (cmd === "news_decode_url")
						return decode(String(args["link"] ?? ""));
					// Launch-time calls the app tolerates failing.
					if (cmd === "keychain_get") return null;
					if (cmd === "keychain_set" || cmd === "keychain_delete")
						return null;
					if (cmd === "plugin:event|listen") return 1;
					throw new Error(`mock-shell: unhandled ${cmd}`);
				},
				transformCallback: (): number => 0,
				unregisterCallback: (): void => {}
			};
			(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ =
				shell;
		},
		{ rss: MOCK_NEWS_RSS, article: MOCK_ARTICLE_HTML }
	);
}
