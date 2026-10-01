import { describe, it, expect } from "vitest";
import { NewsMode, type NewsModeDeps } from "./news-mode.svelte";
import type { Attachment } from "./attachments";
import type { PromptEditor } from "./editor";
import type { KeyValueStore } from "./settings";
import type { NewsPanelState } from "./news";

/** Stub deps with call counters; shell-less like the node runtime. */
function harness(phone = false): {
	mode: NewsMode;
	calls: {
		park: number;
		restore: number;
		sends: number;
		toasts: string[];
		errors: string[];
		seeds: string[];
	};
	setEditorText: (text: string | null) => void;
	setAttachments: (next: Attachment[]) => void;
} {
	const calls = {
		park: 0,
		restore: 0,
		sends: 0,
		toasts: [] as string[],
		errors: [] as string[],
		seeds: [] as string[]
	};
	let editorText: string | null = null;
	let attachments: Attachment[] = [];
	const backing = new Map<string, string>();
	const storage: KeyValueStore = {
		getItem: (k) => backing.get(k) ?? null,
		setItem: (k, v) => void backing.set(k, v)
	};
	const deps: NewsModeDeps = {
		getEditor: () =>
			editorText === null
				? null
				: ({ getText: () => editorText }) as unknown as PromptEditor,
		getAttachments: () => attachments,
		setAttachments: (next) => {
			attachments = next;
		},
		seedComposer: (text) => {
			calls.seeds.push(text);
		},
		toast: (message) => {
			calls.toasts.push(message);
		},
		toastError: (message) => {
			calls.errors.push(message);
		},
		resolveProvider: async () => null,
		getStorage: () => storage,
		isPhone: () => phone,
		parkPrompt: () => {
			calls.park++;
		},
		restorePrompt: () => {
			calls.restore++;
		},
		requestSend: () => {
			calls.sends++;
		},
		onBadge: () => {},
		onBadgeHover: () => {}
	};
	return {
		mode: new NewsMode(deps),
		calls,
		setEditorText: (text) => {
			editorText = text;
		},
		setAttachments: (next) => {
			attachments = next;
		}
	};
}

function readyPanel(over: Partial<NewsPanelState> = {}): NewsPanelState {
	return {
		code: "fr",
		langName: "French",
		regions: [
			{ gl: "FR", label: "France" },
			{ gl: "CA", label: "Canada" }
		],
		region: "FR",
		status: "ready",
		stories: [{ title: "Titre", source: "Desk", link: "link-1", snippet: "" }],
		error: "",
		fallback: false,
		...over
	};
}

describe("enterNewsMode", () => {
	it("ignores unknown codes without parking", () => {
		const { mode, calls } = harness();
		mode.enterNewsMode("xx");
		expect(mode.news).toBeNull();
		expect(calls.park).toBe(0);
	});

	it("opens the default region loading and parks on desktop", () => {
		const { mode, calls } = harness();
		mode.enterNewsMode("fr");
		expect(mode.news?.status).toBe("loading");
		expect(mode.news?.region).toBe("FR");
		expect(mode.news?.fallback).toBe(false);
		expect(mode.newsPicker).toBeNull();
		expect(calls.park).toBe(1);
	});

	it("marks fallback editions and never parks phones", () => {
		const { mode, calls } = harness(true);
		mode.enterNewsMode("da");
		expect(mode.news?.fallback).toBe(true);
		expect(calls.park).toBe(0);
	});
});

describe("picker actions", () => {
	it("toggles the menu, blocked while busy", () => {
		const { mode } = harness();
		mode.news = readyPanel();
		mode.actions.menu("link-1");
		expect(mode.newsPicker).toEqual({ link: "link-1" });
		mode.actions.menu("link-1");
		expect(mode.newsPicker).toBeNull();
		mode.newsBusy = "link-1";
		mode.actions.menu("link-1");
		expect(mode.newsPicker).toBeNull();
	});

	it("sets level/size only on the open card", () => {
		const { mode } = harness();
		mode.news = readyPanel();
		mode.actions.menu("link-1");
		mode.actions.level("link-1", "C1");
		mode.actions.size("link-9", "long");
		expect(mode.newsPicker).toEqual({ link: "link-1", level: "C1" });
	});
});

describe("close/clear/retry", () => {
	it("close drops the panel and restores the composer", () => {
		const { mode, calls } = harness();
		mode.news = readyPanel();
		mode.newsPicker = { link: "link-1" };
		mode.actions.close();
		expect(mode.news).toBeNull();
		expect(mode.newsPicker).toBeNull();
		expect(calls.restore).toBe(1);
	});

	it("clear drops without touching the composer", () => {
		const { mode, calls } = harness();
		mode.news = readyPanel();
		mode.clear();
		expect(mode.news).toBeNull();
		expect(calls.restore).toBe(0);
	});

	it("retry reloads an honest failure", () => {
		const { mode } = harness();
		mode.news = readyPanel({ status: "needs-shell", stories: [] });
		mode.actions.retry();
		expect(mode.news?.status).toBe("loading");
		expect(mode.news?.stories).toEqual([]);
	});
});

describe("switchNewsRegion", () => {
	it("ignores same, unknown, and busy switches", async () => {
		const { mode, calls } = harness();
		mode.news = readyPanel();
		await mode.switchNewsRegion("FR");
		await mode.switchNewsRegion("ZZ");
		mode.newsBusy = "link-1";
		await mode.switchNewsRegion("CA");
		expect(mode.news?.region).toBe("FR");
		expect(mode.news?.status).toBe("ready");
		expect(calls.toasts).toEqual([]);
	});

	it("reloads a native region", async () => {
		const { mode } = harness();
		mode.news = readyPanel();
		mode.newsPicker = { link: "link-1" };
		await mode.switchNewsRegion("CA");
		expect(mode.news?.region).toBe("CA");
		expect(mode.news?.status).toBe("loading");
		expect(mode.newsPicker).toBeNull();
	});

	it("refuses a translated region without a key", async () => {
		const { mode, calls } = harness();
		mode.news = readyPanel({
			regions: [...readyPanel().regions, { gl: "US", label: "U.S.", translate: true }]
		});
		await mode.switchNewsRegion("US");
		expect(mode.news?.region).toBe("FR");
		expect(mode.news?.status).toBe("ready");
		expect(calls.toasts).toEqual(["Set an API key to translate U.S. headlines."]);
	});
});

describe("launchNewsSession", () => {
	it("ignores launches without an editor", async () => {
		const { mode, calls } = harness();
		mode.news = readyPanel();
		await mode.launchNewsSession("link-1", "talk", "B2", "medium");
		expect(mode.newsBusy).toBeNull();
		expect(calls.errors).toEqual([]);
	});

	it("refuses a dirty composer and stays in news", async () => {
		const { mode, calls, setEditorText, setAttachments } = harness();
		mode.news = readyPanel();
		setEditorText("draft");
		await mode.launchNewsSession("link-1", "talk", "B2", "medium");
		setEditorText("");
		setAttachments([{ id: "a" } as unknown as Attachment]);
		await mode.launchNewsSession("link-1", "talk", "B2", "medium");
		expect(calls.errors).toEqual([
			"Clear the composer first — the story needs an empty draft.",
			"Clear the composer first — the story needs an empty draft."
		]);
		expect(mode.news?.status).toBe("ready");
		expect(mode.newsBusy).toBeNull();
	});

	it("stays in news when the shell is missing", async () => {
		const { mode, calls, setEditorText } = harness();
		mode.news = readyPanel();
		setEditorText("");
		await mode.launchNewsSession("link-1", "read", "B2", "medium");
		expect(mode.news?.status).toBe("ready");
		expect(mode.newsBusy).toBeNull();
		expect(calls.seeds).toEqual([]);
		expect(calls.sends).toBe(0);
		expect(calls.errors).toEqual([
			"News needs the app shell — the browser preview can't reach it."
		]);
	});
});

describe("resolveNewsImages", () => {
	it("settles shell-less stories to misses", async () => {
		const { mode } = harness();
		const panel = readyPanel();
		mode.news = panel;
		await mode.resolveNewsImages(panel.code, panel.region, panel.stories);
		expect(mode.newsImages).toEqual({ "link-1": null });
		expect(mode.newsImageSession.get("link-1")).toBeNull();
	});
});
