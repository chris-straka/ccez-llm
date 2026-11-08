import { describe, it, expect } from "vitest";
import { NewsMode, type NewsModeDeps } from "./news-mode.svelte";
import type { Attachment } from "./attachments";
import type { PromptEditor } from "./editor";
import type { KeyValueStore } from "./settings";
import type { NewsPanelState } from "./news";

/** Stub deps with call counters; shell-less like the node runtime. */
function harness(
	phone = false,
	reply: ((prompt: string) => Promise<string>) | null = null
): {
	mode: NewsMode;
	calls: {
		park: number;
		restore: number;
		sends: number;
		toasts: string[];
		errors: string[];
		seeds: string[];
		ticks: number;
		denials: number;
	};
	setEditorText: (text: string | null) => void;
	setAttachments: (next: Attachment[]) => void;
	storage: KeyValueStore;
} {
	const calls = {
		park: 0,
		restore: 0,
		sends: 0,
		toasts: [] as string[],
		errors: [] as string[],
		seeds: [] as string[],
		ticks: 0,
		denials: 0
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
				: ({ getText: () => editorText } as unknown as PromptEditor),
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
		tapTick: () => {
			calls.ticks++;
		},
		denyBuzz: () => {
			calls.denials++;
		},
		resolveProvider: async () =>
			reply
				? ({
						chat: async (msgs: { content: string }[]) => ({
							content: await reply(msgs[0]!.content)
						})
					} as unknown as Awaited<ReturnType<NewsModeDeps["resolveProvider"]>>)
				: null,
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
		}
	};
	return {
		mode: new NewsMode(deps),
		calls,
		setEditorText: (text) => {
			editorText = text;
		},
		setAttachments: (next) => {
			attachments = next;
		},
		storage
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
		expect(mode.staged).toBeNull();
		expect(calls.park).toBe(1);
	});

	it("marks fallback editions and never parks phones", () => {
		const { mode, calls } = harness(true);
		mode.enterNewsMode("da");
		expect(mode.news?.fallback).toBe(true);
		expect(calls.park).toBe(0);
	});
});

describe("staging a story", () => {
	it("puts the picked story in the chat with remembered picks", () => {
		const { mode, calls, storage } = harness();
		storage.setItem(
			"ccez-news-picks-v1",
			JSON.stringify({ level: "C1", size: "long" })
		);
		mode.news = readyPanel();
		mode.actions.pick("link-1");
		expect(mode.staged).toMatchObject({
			link: "link-1",
			level: "C1",
			size: "long",
			article: "loading"
		});
		expect(calls.ticks).toBe(1);
	});

	it("ignores unknown stories, unready panels, and busy launches", () => {
		const { mode } = harness();
		mode.news = readyPanel();
		mode.actions.pick("link-9");
		expect(mode.staged).toBeNull();
		mode.news = readyPanel({ status: "translating" });
		mode.actions.pick("link-1");
		expect(mode.staged).toBeNull();
		mode.news = readyPanel();
		mode.newsBusy = "link-1";
		mode.actions.pick("link-1");
		expect(mode.staged).toBeNull();
	});

	it("surfaces an article that can't be read, retry stages again", async () => {
		const { mode } = harness();
		mode.news = readyPanel();
		mode.actions.pick("link-1");
		// Shell-less: the article fetch fails honestly.
		await new Promise((r) => setTimeout(r, 0));
		expect(mode.staged?.article).toBe("error");
		expect(mode.staged?.error).toContain("app shell");
		mode.actions.retry();
		expect(mode.staged?.article).toBe("loading");
		expect(mode.news?.status).toBe("ready");
	});

	it("kind, level and size change the staged story and are remembered", () => {
		const { mode, storage } = harness();
		mode.news = readyPanel();
		mode.actions.level("A2");
		expect(mode.staged).toBeNull();
		mode.actions.pick("link-1");
		mode.actions.kind("read");
		mode.actions.level("A2");
		mode.actions.size("short");
		expect(mode.staged).toMatchObject({
			kind: "read",
			level: "A2",
			size: "short"
		});
		expect(JSON.parse(storage.getItem("ccez-news-picks-v1") ?? "{}")).toEqual({
			kind: "read",
			level: "A2",
			size: "short"
		});
	});

	it("unpick returns to the headlines", () => {
		const { mode } = harness();
		mode.news = readyPanel();
		mode.actions.pick("link-1");
		mode.actions.unpick();
		expect(mode.staged).toBeNull();
		expect(mode.news?.status).toBe("ready");
	});
});

describe("feed cache", () => {
	it("opens a cached region instantly, no fetch", async () => {
		const { mode, storage } = harness();
		const stories = [
			{ title: "Cached", source: "Desk", link: "c-1", snippet: "" }
		];
		storage.setItem(
			"ccez-news-feeds-v1",
			JSON.stringify({ "fr|FR": { stories, at: Date.now() } })
		);
		mode.enterNewsMode("fr");
		await Promise.resolve();
		expect(mode.news?.status).toBe("ready");
		expect(mode.news?.stories).toEqual(stories);
	});
});

describe("close/clear/retry", () => {
	it("close drops the panel and restores the composer", () => {
		const { mode, calls } = harness();
		mode.news = readyPanel();
		mode.actions.pick("link-1");
		mode.actions.close();
		expect(mode.news).toBeNull();
		expect(mode.staged).toBeNull();
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
		const { mode, calls } = harness();
		mode.news = readyPanel();
		mode.actions.pick("link-1");
		await mode.switchNewsRegion("CA");
		expect(mode.news?.region).toBe("CA");
		expect(mode.news?.status).toBe("loading");
		expect(mode.staged).toBeNull();
		expect(calls.ticks).toBe(2);
	});

	it("refuses a translated region without a key", async () => {
		const { mode, calls } = harness();
		mode.news = readyPanel({
			regions: [
				...readyPanel().regions,
				{ gl: "US", label: "U.S.", translate: true }
			]
		});
		await mode.switchNewsRegion("US");
		expect(mode.news?.region).toBe("FR");
		expect(mode.news?.status).toBe("ready");
		expect(calls.toasts).toEqual([
			"Set an API key to translate U.S. headlines."
		]);
		expect(calls.denials).toBe(1);
		expect(calls.ticks).toBe(0);
	});
});

describe("translatePending", () => {
	const pending = (n: number) =>
		Array.from({ length: n }, (_, i) => ({
			title: `Headline ${i + 1}`,
			source: "Desk",
			link: `l${i + 1}`,
			snippet: "",
			pending: true as const
		}));
	const flush = () => new Promise((r) => setTimeout(r, 0));

	it("translates the card in view and the next two on a phone", async () => {
		const prompts: string[] = [];
		const { mode } = harness(true, async (prompt) => {
			prompts.push(prompt);
			return "1. Titre 2\n2. Titre 3\n3. Titre 4";
		});
		mode.news = readyPanel({ stories: pending(5) });
		mode.translatePending("l2");
		// Already on its way: a second sighting asks nothing more.
		mode.translatePending("l2");
		await flush();
		expect(prompts).toHaveLength(1);
		expect(prompts[0]).toContain("1. Headline 2\n2. Headline 3\n3. Headline 4");
		expect(
			mode.news?.stories.map((s) => [s.title, s.pending ?? false])
		).toEqual([
			["Headline 1", true],
			["Titre 2", false],
			["Titre 3", false],
			["Titre 4", false],
			["Headline 5", true]
		]);
	});

	it("leaves a failed batch pending so it can ask again", async () => {
		let fail = true;
		const { mode } = harness(true, async () => {
			if (fail) throw new Error("down");
			return "1. Un\n2. Deux\n3. Trois";
		});
		mode.news = readyPanel({ stories: pending(3) });
		mode.translatePending("l1");
		await flush();
		expect(mode.news?.stories.every((s) => s.pending)).toBe(true);
		fail = false;
		mode.translatePending("l1");
		await flush();
		expect(mode.news?.stories.map((s) => s.title)).toEqual([
			"Un",
			"Deux",
			"Trois"
		]);
	});

	it("drops a batch that lands after the desk changed", async () => {
		let answer: (text: string) => void = () => {};
		const { mode } = harness(
			true,
			() => new Promise<string>((r) => (answer = r))
		);
		mode.news = readyPanel({ stories: pending(1) });
		mode.translatePending("l1");
		await flush();
		mode.newsSeq++;
		answer("1. Un");
		await flush();
		expect(mode.news?.stories[0]?.pending).toBe(true);
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

	it("launches over a dirty draft instead of refusing", async () => {
		const { mode, calls, setEditorText } = harness();
		mode.news = readyPanel();
		setEditorText("half-typed thought");
		// Shell-less, so the fetch fails — but the draft never blocks:
		// the failure copy (not a composer complaint) is the error,
		// and the seed only ever lands after a fetch that worked.
		await mode.launchNewsSession("link-1", "talk", "B2", "medium");
		expect(calls.errors).toEqual([
			"News needs the app shell — the browser preview can't reach it."
		]);
		expect(calls.seeds).toEqual([]);
		expect(calls.denials).toBe(1);
		expect(mode.news?.status).toBe("ready");
		expect(mode.newsBusy).toBeNull();
	});

	it("still blocks on staged attachments (never silently dropped)", async () => {
		const { mode, calls, setEditorText, setAttachments } = harness();
		mode.news = readyPanel();
		setEditorText("");
		setAttachments([{ id: "a" } as unknown as Attachment]);
		await mode.launchNewsSession("link-1", "talk", "B2", "medium");
		expect(calls.errors).toEqual([
			"Remove attachments first — the story brings its own article."
		]);
		expect(calls.denials).toBe(1);
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
		expect(calls.denials).toBe(1);
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
