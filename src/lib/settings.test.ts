import { describe, it, expect } from "vitest";
import { asProviderId } from "./providers/registry";
import {
	defaultSettings,
	envProviderDefaults,
	loadSettings,
	saveSettings,
	memoryStore,
	DEFAULT_SYSTEM_PROMPT,
	CHAT_WIDTH_DEFAULT,
	CHAT_WIDTH_MAX,
	CHAT_WIDTH_MIN,
	CHAT_WIDTH_FULLBLEED_REM,
	MESSAGE_GAP_DEFAULT,
	MESSAGE_GAP_MAX,
	MESSAGE_GAP_MIN,
	effectiveChatWidth,
	PROMPT_IDLE_ALWAYS,
	PROMPT_IDLE_DEFAULT,
	PROMPT_IDLE_MAX,
	PROMPT_IDLE_MIN,
	activeThinkingId,
	effectiveSystemPrompt,
	LOOKUP_CAPABILITY_HINT,
	systemLocale,
	resolveTheme,
	type AppSettings
} from "./settings";

/** Blank slate: tests must never see the developer's real `.env`. */
function blankSettings() {
	const s = defaultSettings();
	s.providers["deepseek"]!.apiKey = "";
	s.providers["muse"]!.apiKey = "";
	return s;
}

describe("settings", () => {
	it("defaults to per-model thinking, voice off, empty system prompt", () => {
		const s = defaultSettings();
		expect(s.thinking).toEqual({});
		// Unset resolves to each model's default (muse → medium).
		expect(activeThinkingId(s)).toBe("medium");
		expect("readingAids" in s).toBe(false);
		expect(s.vim).toBe(true);
		expect(s.voice).toBe(false);
		expect(s.ownBubble).toBe(false);
		expect(s.hoverUserActions).toBe(true);
		expect(s.hoverAssistantActions).toBe(true);
		expect(s.scaleActionsWithFont).toBe(false);
		expect(s.promptIdleSec).toBe(PROMPT_IDLE_DEFAULT);
		expect(s.voiceEngine).toBe("native");
		// Locale-aware: defaultSettings() follows systemLocale() (OS locale),
		// so this must track the helper, not a hardcoded tag.
		expect(s.voiceLang).toBe(systemLocale());
		expect(s.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
		expect(s.providers["deepseek"]!.model).toBe("deepseek-flash");
		expect(s.providers["muse"]!.model).toBe("muse-spark-1.3-contributor");
		expect(s.providers["muse"]!.models).toEqual([]);
	});

	it("defaults text size to 1 and backfills/clamps old saves", () => {
		expect(defaultSettings().fontScale).toBe(1);
		const s = blankSettings();
		delete (s as unknown as Record<string, unknown>).fontScale;
		saveSettings(s, memoryStore);
		expect(loadSettings(memoryStore).fontScale).toBe(1);
		const bad = blankSettings();
		(bad as unknown as Record<string, unknown>).fontScale = "huge";
		saveSettings(bad, memoryStore);
		expect(loadSettings(memoryStore).fontScale).toBe(1);
		const kept = blankSettings();
		kept.fontScale = 1.2;
		saveSettings(kept, memoryStore);
		expect(loadSettings(memoryStore).fontScale).toBe(1.2);
	});

	it("reads the pre-rename settings key", () => {
		const data = new Map<string, string>();
		const store = {
			getItem: (k: string) => data.get(k) ?? null,
			setItem: (k: string, v: string) => void data.set(k, v)
		};
		store.setItem(
			"ccez-studio-settings-v1",
			JSON.stringify({ ...blankSettings(), fontScale: 1.5 })
		);
		expect(loadSettings(store).fontScale).toBe(1.5);
	});

	it("migrates the local-gemma provider id to local-mlkit", () => {
		const data = new Map<string, string>();
		const store = {
			getItem: (k: string) => data.get(k) ?? null,
			setItem: (k: string, v: string) => void data.set(k, v)
		};
		const saved = {
			...blankSettings(),
			activeProviderId: "local-gemma",
			providers: {
				...blankSettings().providers,
				"local-gemma": {
					baseUrl: "http://localhost:11434/v1",
					apiKey: "",
					model: "gemma4:latest",
					models: []
				}
			},
			thinking: { "local-gemma": "low" }
		};
		store.setItem("ccez-studio-settings-v1", JSON.stringify(saved));
		const loaded = loadSettings(store);
		expect(loaded.activeProviderId).toBe("local-mlkit");
		expect(loaded.providers["local-mlkit"]).toMatchObject({
			model: "gemma4:latest"
		});
		expect(loaded.providers["local-gemma"]).toBeUndefined();
		expect(loaded.thinking["local-mlkit"]).toBe("low");
		expect(loaded.thinking["local-gemma"]).toBeUndefined();
	});

	it("persists text size up to 800% and resets strays", () => {
		const max = blankSettings();
		max.fontScale = 8;
		saveSettings(max, memoryStore);
		expect(loadSettings(memoryStore).fontScale).toBe(8);
		const over = blankSettings();
		over.fontScale = 8.5;
		saveSettings(over, memoryStore);
		expect(loadSettings(memoryStore).fontScale).toBe(1);
	});

	it("drops legacy transparency keys from older saves", () => {
		// The opacity sliders are gone (surfaces are solid now): stored
		// values purge on load like other retired keys.
		const s = blankSettings() as unknown as Record<string, unknown>;
		s.bgOpacity = 0.5;
		s.composerOpacity = 0.5;
		saveSettings(s as never, memoryStore);
		const loaded = loadSettings(memoryStore) as unknown as Record<
			string,
			unknown
		>;
		expect("bgOpacity" in loaded).toBe(false);
		expect("composerOpacity" in loaded).toBe(false);
		expect("bgOpacity" in defaultSettings()).toBe(false);
		expect("composerOpacity" in defaultSettings()).toBe(false);
	});

	it("defaults chat width to the legacy column and clamps strays", () => {
		expect(defaultSettings().chatWidth).toBe(36);
		expect(CHAT_WIDTH_DEFAULT).toBe(36);
		const s = blankSettings();
		delete (s as unknown as Record<string, unknown>).chatWidth;
		saveSettings(s, memoryStore);
		expect(loadSettings(memoryStore).chatWidth).toBe(CHAT_WIDTH_DEFAULT);
		const kept = blankSettings();
		kept.chatWidth = 32;
		saveSettings(kept, memoryStore);
		expect(loadSettings(memoryStore).chatWidth).toBe(32);
		const low = blankSettings();
		low.chatWidth = CHAT_WIDTH_MIN - 10;
		saveSettings(low, memoryStore);
		expect(loadSettings(memoryStore).chatWidth).toBe(CHAT_WIDTH_MIN);
		const high = blankSettings();
		high.chatWidth = CHAT_WIDTH_MAX + 10;
		saveSettings(high, memoryStore);
		expect(loadSettings(memoryStore).chatWidth).toBe(CHAT_WIDTH_MAX);
		const junk = blankSettings();
		(junk as unknown as Record<string, unknown>).chatWidth = "wide";
		saveSettings(junk, memoryStore);
		expect(loadSettings(memoryStore).chatWidth).toBe(CHAT_WIDTH_DEFAULT);
	});

	it("hides the prompt whenever unfocused out of the box", () => {
		expect(PROMPT_IDLE_DEFAULT).toBe(PROMPT_IDLE_ALWAYS);
		expect(defaultSettings().promptIdleSec).toBe(PROMPT_IDLE_ALWAYS);
	});

	it("backfills and clamps the prompt idle timeout on old saves", () => {
		expect(defaultSettings().promptIdleSec).toBe(PROMPT_IDLE_DEFAULT);
		const s = blankSettings();
		delete (s as unknown as Record<string, unknown>).promptIdleSec;
		saveSettings(s, memoryStore);
		expect(loadSettings(memoryStore).promptIdleSec).toBe(PROMPT_IDLE_DEFAULT);
		const kept = blankSettings();
		kept.promptIdleSec = 10;
		saveSettings(kept, memoryStore);
		expect(loadSettings(memoryStore).promptIdleSec).toBe(10);
		const low = blankSettings();
		low.promptIdleSec = PROMPT_IDLE_MIN - 1;
		saveSettings(low, memoryStore);
		expect(loadSettings(memoryStore).promptIdleSec).toBe(PROMPT_IDLE_DEFAULT);
		const high = blankSettings();
		high.promptIdleSec = PROMPT_IDLE_MAX + 1;
		saveSettings(high, memoryStore);
		expect(loadSettings(memoryStore).promptIdleSec).toBe(PROMPT_IDLE_DEFAULT);
	});

	it("keeps saved message chrome while fresh installs start plain and hover-only", () => {
		const kept = blankSettings();
		kept.ownBubble = true;
		kept.hoverUserActions = false;
		kept.hoverAssistantActions = false;
		kept.scaleActionsWithFont = true;
		saveSettings(kept, memoryStore);
		const reloaded = loadSettings(memoryStore);
		expect(reloaded.ownBubble).toBe(true);
		expect(reloaded.hoverUserActions).toBe(false);
		expect(reloaded.hoverAssistantActions).toBe(false);
		expect(reloaded.scaleActionsWithFont).toBe(true);
	});

	it("allows chat widths past 80rem", () => {
		expect(CHAT_WIDTH_MAX).toBeGreaterThan(80);
		const kept = blankSettings();
		kept.chatWidth = 100;
		saveSettings(kept, memoryStore);
		expect(loadSettings(memoryStore).chatWidth).toBe(100);
	});

	it("shows message buttons out of the box and keeps an explicit off", () => {
		expect(defaultSettings().showMessageButtons).toBe(true);
		const off = blankSettings();
		off.showMessageButtons = false;
		saveSettings(off, memoryStore);
		expect(loadSettings(memoryStore).showMessageButtons).toBe(false);
		const junk = blankSettings();
		(junk as unknown as Record<string, unknown>).showMessageButtons = "no";
		saveSettings(junk, memoryStore);
		expect(loadSettings(memoryStore).showMessageButtons).toBe(true);
	});

	it("defaults the message gap tight and clamps strays", () => {
		expect(MESSAGE_GAP_DEFAULT).toBe(0.35);
		expect(defaultSettings().messageGap).toBe(MESSAGE_GAP_DEFAULT);
		const missing = blankSettings();
		delete (missing as unknown as Record<string, unknown>).messageGap;
		saveSettings(missing, memoryStore);
		expect(loadSettings(memoryStore).messageGap).toBe(MESSAGE_GAP_DEFAULT);
		const kept = blankSettings();
		kept.messageGap = 0.8;
		saveSettings(kept, memoryStore);
		expect(loadSettings(memoryStore).messageGap).toBe(0.8);
		const low = blankSettings();
		low.messageGap = MESSAGE_GAP_MIN - 0.1;
		saveSettings(low, memoryStore);
		expect(loadSettings(memoryStore).messageGap).toBe(MESSAGE_GAP_MIN);
		const high = blankSettings();
		high.messageGap = MESSAGE_GAP_MAX + 1;
		saveSettings(high, memoryStore);
		expect(loadSettings(memoryStore).messageGap).toBe(MESSAGE_GAP_MAX);
		const junk = blankSettings();
		(junk as unknown as Record<string, unknown>).messageGap = "roomy";
		saveSettings(junk, memoryStore);
		expect(loadSettings(memoryStore).messageGap).toBe(MESSAGE_GAP_DEFAULT);
	});

	it("defaults background reply pings on and clamps old saves", () => {
		expect(defaultSettings().replyNotifications).toBe(true);
		const kept = blankSettings();
		kept.replyNotifications = false;
		saveSettings(kept, memoryStore);
		expect(loadSettings(memoryStore).replyNotifications).toBe(false);
		const old = blankSettings();
		(old as unknown as Record<string, unknown>).replyNotifications = "yes";
		saveSettings(old, memoryStore);
		expect(loadSettings(memoryStore).replyNotifications).toBe(true);
	});

	it("sizes the chat column full-bleed on huge phone type", () => {
		expect(effectiveChatWidth(false, 4, 36)).toBe(36);
		expect(effectiveChatWidth(false, 8, 120)).toBe(120);
		expect(effectiveChatWidth(true, 1, 36)).toBe(46);
		expect(effectiveChatWidth(true, 3.29, 36)).toBe(46);
		expect(effectiveChatWidth(true, 3.3, 36)).toBe(CHAT_WIDTH_FULLBLEED_REM);
		expect(effectiveChatWidth(true, 8, 120)).toBe(CHAT_WIDTH_FULLBLEED_REM);
	});

	it("defaults mic dictation on and keeps an explicit off", () => {
		expect(defaultSettings().micEnabled).toBe(true);
		const off = blankSettings();
		off.micEnabled = false;
		saveSettings(off, memoryStore);
		expect(loadSettings(memoryStore).micEnabled).toBe(false);
		const junk = blankSettings();
		(junk as unknown as Record<string, unknown>).micEnabled = "yes";
		saveSettings(junk, memoryStore);
		expect(loadSettings(memoryStore).micEnabled).toBe(true);
	});

	it("migrates the shared thinking dial to per-provider native ids", () => {
		const raw = blankSettings();
		(raw as unknown as Record<string, unknown>)["thinkingLevel"] = "high";
		delete (raw as unknown as Record<string, unknown>)["thinking"];
		saveSettings(raw, memoryStore);
		const loaded = loadSettings(memoryStore);
		expect(loaded.thinking).toEqual({ muse: "high", deepseek: "max" });
		expect("thinkingLevel" in loaded).toBe(false);
		const low = blankSettings();
		(low as unknown as Record<string, unknown>)["thinkingLevel"] = "low";
		delete (low as unknown as Record<string, unknown>)["thinking"];
		saveSettings(low, memoryStore);
		expect(loadSettings(memoryStore).thinking).toEqual({
			muse: "low",
			deepseek: "high"
		});
	});

	it("composes thinking hint and reply language into the prompt", () => {
		const s = defaultSettings();
		s.systemPrompt = "Be brief.";
		// Muse sends thinking natively: no prompt hint.
		expect(effectiveSystemPrompt(s)).toBe("Be brief.");
		// Generic providers fall back to prompt hints.
		s.customProviders = [
			{
				id: asProviderId("x"),
				label: "X",
				defaultBaseUrl: "https://x.test",
				defaultModel: "xm",
				keyHint: ""
			}
		];
		s.providers["x"] = {
			baseUrl: "https://x.test",
			apiKey: "",
			model: "xm",
			models: []
		};
		s.activeProviderId = asProviderId("x");
		s.thinking = { x: "high" };
		expect(effectiveSystemPrompt(s)).toBe(
			"Be brief. Think carefully before answering."
		);
		s.thinking = { x: "medium" };
		expect(effectiveSystemPrompt(s)).toBe("Be brief.");
		s.thinking = { x: "low" };
		s.replyLang = "fr";
		expect(effectiveSystemPrompt(s)).toBe(
			"Be brief. Answer directly with minimal deliberation. Reply in French."
		);
		s.replyLang = "nope";
		expect(effectiveSystemPrompt(s)).toBe(
			"Be brief. Answer directly with minimal deliberation."
		);
	});

	it("defaults to Muse with an empty system prompt", () => {
		const s = defaultSettings();
		expect(s.activeProviderId).toBe("muse");
		expect(s.systemPrompt).toBe("");
	});

	it("adds the lookup line only for tool-capable providers", () => {
		const s = defaultSettings();
		s.systemPrompt = "Be brief.";
		expect(effectiveSystemPrompt(s)).toBe("Be brief.");
		expect(effectiveSystemPrompt(s, null, false)).toBe("Be brief.");
		expect(effectiveSystemPrompt(s, null, true)).toBe(
			`Be brief. ${LOOKUP_CAPABILITY_HINT}`
		);
	});

	it("drops the retired global reading-aids key", () => {
		const s = blankSettings();
		(s as unknown as Record<string, unknown>)["readingAids"] = true;
		saveSettings(s, memoryStore);
		expect("readingAids" in loadSettings(memoryStore)).toBe(false);
	});

	it("splits the legacy hover-actions toggle across both sides", () => {
		const s = blankSettings();
		(s as unknown as Record<string, unknown>).hoverActions = true;
		delete (s as unknown as Record<string, unknown>).hoverUserActions;
		delete (s as unknown as Record<string, unknown>).hoverAssistantActions;
		saveSettings(s, memoryStore);
		const loaded = loadSettings(memoryStore);
		expect(loaded.hoverUserActions).toBe(true);
		expect(loaded.hoverAssistantActions).toBe(true);
		expect("hoverActions" in loaded).toBe(false);
		const kept = blankSettings();
		kept.hoverUserActions = true;
		kept.hoverAssistantActions = false;
		saveSettings(kept, memoryStore);
		const reloaded = loadSettings(memoryStore);
		expect(reloaded.hoverUserActions).toBe(true);
		expect(reloaded.hoverAssistantActions).toBe(false);
	});

	it("migrates the retired default prompt but keeps custom ones", () => {
		const s = blankSettings();
		s.systemPrompt = "Be brief, no summaries.";
		saveSettings(s, memoryStore);
		expect(loadSettings(memoryStore).systemPrompt).toBe("");
		s.systemPrompt = "Talk like a pirate.";
		saveSettings(s, memoryStore);
		expect(loadSettings(memoryStore).systemPrompt).toBe("Talk like a pirate.");
	});

	it("drops a persisted reply language and its voice override on load", () => {
		const s = blankSettings();
		s.replyLang = "ar";
		s.voiceLang = "ar-SA";
		saveSettings(s, memoryStore);
		const loaded = loadSettings(memoryStore);
		expect(loaded.replyLang).toBeNull();
		expect(loaded.voiceLang).toBe(systemLocale());
	});

	it("keeps a pinned voice across restarts", () => {
		const s = blankSettings();
		s.replyLang = null;
		s.voiceLang = "fr-FR";
		s.voiceLangPinned = true;
		saveSettings(s, memoryStore);
		const loaded = loadSettings(memoryStore);
		expect(loaded.replyLang).toBeNull();
		expect(loaded.voiceLang).toBe("fr-FR");
	});

	it("returns an unpinned voice to the default on load", () => {
		const s = blankSettings();
		s.replyLang = null;
		s.voiceLang = "fr-FR";
		s.voiceLangPinned = false;
		saveSettings(s, memoryStore);
		const loaded = loadSettings(memoryStore);
		expect(loaded.voiceLang).toBe(systemLocale());
	});

	it("never clobbers a saved key when loading", () => {
		const s = blankSettings();
		s.providers["muse"]!.apiKey = "typed";
		saveSettings(s, memoryStore);
		expect(loadSettings(memoryStore).providers["muse"]!.apiKey).toBe("typed");
	});

	it("resolves dev-time env names, VITE_ first", () => {
		expect(
			envProviderDefaults({
				META_OPENAI_API_KEY_MUSE_SPARK_ONE_POINT_THREE: "sk-legacy",
				META_BASE_URL: "https://meta.example"
			}).muse
		).toEqual({
			baseUrl: "https://meta.example",
			apiKey: "sk-legacy",
			model: "muse-spark-1.3-contributor",
			models: []
		});
		expect(
			envProviderDefaults({
				META_OPENAI_API_KEY_MUSE_SPARK_ONE_POINT_THREE: "sk-legacy",
				VITE_MUSE_API_KEY: "sk-vite"
			}).muse!.apiKey
		).toBe("sk-vite");
		expect(envProviderDefaults({}).muse!.apiKey).toBe("");
	});

	it("starts with no custom providers and resets unknown active ids", () => {
		expect(defaultSettings().customProviders).toEqual([]);
		const s = blankSettings();
		s.activeProviderId = asProviderId("custom-gone");
		saveSettings(s, memoryStore);
		expect(loadSettings(memoryStore).activeProviderId).toBe("muse");
	});

	it("backfills customProviders on older saves", () => {
		const s = blankSettings();
		delete (s as unknown as Record<string, unknown>).customProviders;
		saveSettings(s, memoryStore);
		expect(loadSettings(memoryStore).customProviders).toEqual([]);
	});

	it("backfills a null voice pick on older saves", () => {
		const s = blankSettings();
		delete (s as unknown as Record<string, unknown>).nativeVoiceId;
		saveSettings(s, memoryStore);
		expect(loadSettings(memoryStore).nativeVoiceId).toBeNull();
	});

	it("defaults voice locale from the system locale", () => {
		// Node 21+ ships a getter-only global navigator: swap it by descriptor.
		const desc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
		const setNavigator = (language: string) =>
			Object.defineProperty(globalThis, "navigator", {
				value: { language },
				configurable: true
			});
		const restore = () => {
			if (desc) Object.defineProperty(globalThis, "navigator", desc);
		};
		setNavigator("fr-FR");
		try {
			expect(systemLocale()).toBe("fr-FR");
			expect(defaultSettings().voiceLang).toBe("fr-FR");
		} finally {
			restore();
		}
		setNavigator("not a tag!!!");
		try {
			expect(systemLocale()).toBe("en-US");
		} finally {
			restore();
		}
	});

	it("round-trips through a store and survives corrupt JSON", () => {
		const s = blankSettings();
		s.providers["muse"]!.apiKey = "secret";
		saveSettings(s, memoryStore);
		const loaded = loadSettings(memoryStore);
		expect(loaded.providers["muse"]!.apiKey).toBe("secret");

		memoryStore.setItem("ccez-llm-settings-v1", "{not json");
		expect(loadSettings(memoryStore)).toEqual(defaultSettings());
	});
});

describe("theme", () => {
	it("defaults to system and resolves pins over the OS", () => {
		expect(blankSettings().theme).toBe("system");
		expect(resolveTheme("system", true)).toBe("dark");
		expect(resolveTheme("system", false)).toBe("light");
		expect(resolveTheme("dark", false)).toBe("dark");
		expect(resolveTheme("light", true)).toBe("light");
	});
	it("heals unknown saved values back to system", () => {
		const store = memoryStore;
		const s = blankSettings();
		saveSettings({ ...s, theme: "midnight" as never }, store);
		expect(loadSettings(store).theme).toBe("system");
	});
});

describe("touch toggles", () => {
	it("default to shown messages, hidden buttons, speaking selections", () => {
		const s = blankSettings();
		expect(s.hideMessages).toBe(false);
		expect(s.hideButtons).toBe(true);
		expect(s.autoSpeakSelection).toBe(true);
		expect(s.hapticsDisabled).toBe(false);
	});
	it("migrates the legacy vibration toggle (explicit off stays off)", () => {
		// Legacy saves predate hapticsDisabled: only an explicit
		// vibration:false becomes disabled (blankSettings carries the
		// new default, so strip it to simulate the old shape).
		const legacy = (vibration: boolean): Record<string, unknown> => {
			const rest: Record<string, unknown> = { ...blankSettings() };
			delete rest.hapticsDisabled;
			return { ...rest, vibration };
		};
		const store = memoryStore;
		saveSettings(legacy(false) as unknown as AppSettings, store);
		const healed = loadSettings(store);
		expect(healed.hapticsDisabled).toBe(true);
		expect("vibration" in healed).toBe(false);
		const store2 = memoryStore;
		saveSettings(legacy(true) as unknown as AppSettings, store2);
		expect(loadSettings(store2).hapticsDisabled).toBe(false);
	});
	it("drops the retired overlay pill from older saves", () => {
		const store = memoryStore;
		const stale = {
			...blankSettings(),
			overlayActions: true
		} as unknown as Record<string, unknown>;
		saveSettings(stale as unknown as AppSettings, store);
		const healed = loadSettings(store);
		expect("overlayActions" in healed).toBe(false);
	});
	it("drops the retired iOS bubble toggle from older saves", () => {
		const store = memoryStore;
		const s = blankSettings();
		const stale = {
			...s,
			hideMessages: "yes",
			hideButtons: 0,
			autoSpeakSelection: 0,
			hapticsDisabled: "yes"
		} as unknown as Record<string, unknown>;
		stale.iosNativeCallout = true;
		stale.overlayActions = 0;
		saveSettings(stale as unknown as AppSettings, store);
		const healed = loadSettings(store);
		expect(healed.hideMessages).toBe(false);
		expect(healed.hideButtons).toBe(true);
		expect(healed.autoSpeakSelection).toBe(true);
		expect(healed.hapticsDisabled).toBe(false);
		expect("iosNativeCallout" in healed).toBe(false);
		expect("overlayActions" in healed).toBe(false);
	});
});
