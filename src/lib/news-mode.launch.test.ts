import { describe, it, expect, vi } from "vitest";
import type { NewsModeDeps } from "./news-mode.svelte";
import type { PromptEditor } from "./editor";
import type { NewsPanelState } from "./news";

/** Article fetch held open so the panel can go away mid-flight. */
let release: (text: string) => void = () => {};
vi.mock("./news", async (importOriginal) => ({
	...(await importOriginal<typeof import("./news")>()),
	resolveArticleText: () =>
		new Promise<{ text: string }>((resolve) => {
			release = (text) => resolve({ text });
		})
}));
const { NewsMode } = await import("./news-mode.svelte");

function setup() {
	const seeds: string[] = [];
	let sends = 0;
	const deps = {
		getEditor: () => ({ getText: () => "" }) as unknown as PromptEditor,
		getAttachments: () => [],
		setAttachments: () => {},
		seedComposer: (text: string) => void seeds.push(text),
		toast: () => {},
		toastError: () => {},
		tapTick: () => {},
		denyBuzz: () => {},
		resolveProvider: async () => null,
		getStorage: () => ({ getItem: () => null, setItem: () => {} }),
		isPhone: () => false,
		parkPrompt: () => {},
		restorePrompt: () => {},
		requestSend: () => void sends++
	} as unknown as NewsModeDeps;
	return { mode: new NewsMode(deps), seeds, sends: () => sends };
}

const panel = (): NewsPanelState => ({
	code: "ja",
	langName: "Japanese",
	regions: [{ gl: "JP", label: "Japan" }],
	region: "JP",
	status: "ready",
	stories: [{ title: "見出し", source: "Desk", link: "link-1", snippet: "" }],
	error: "",
	fallback: false
});

describe("story launch in flight", () => {
	it("seeds and sends when the panel is still there", async () => {
		const { mode, seeds, sends } = setup();
		mode.news = panel();
		const launch = mode.launchNewsSession("link-1", "read", "B2", "medium");
		release("article body");
		await launch;
		expect(seeds).toHaveLength(1);
		expect(sends()).toBe(1);
	});

	it("never seeds the next chat after its own chat went away", async () => {
		const { mode, seeds, sends } = setup();
		mode.news = panel();
		const launch = mode.launchNewsSession("link-1", "read", "B2", "medium");
		// The chat is deleted mid-fetch; the next blank chat shows the
		// same language's panel.
		mode.clear();
		mode.news = panel();
		release("article body");
		await launch;
		expect(seeds).toEqual([]);
		expect(sends()).toBe(0);
		expect(mode.newsBusy).toBeNull();
	});
});
