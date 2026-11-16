import { OpenAICompatProvider } from "./openai-compat";
import { ZEN_BASE_URL, zenFreeModel, zenModelList } from "./zen";
import { tauriBackendAvailable } from "../secrets";
import { DEEPSEEK_MODEL } from "./deepseek";

/** ccez-words on z: DeepSeek with the owner's key added there. */
export const DEEPSEEK_MAC_URL = "https://z.tailfe37c2.ts.net:8448/ai/deepseek";

/** `models.rs` `list_models`: the shell's CORS-free `/models` read. */
async function nativeModelList(
	baseUrl: string,
	apiKey: string
): Promise<{ status: number; body: string }> {
	const { invoke } = await import("@tauri-apps/api/core");
	return invoke("list_models", { baseUrl, apiKey });
}

/**
 * Branded provider id (same trick as ChatId/ChatMsgId): a chat id never
 * compiles where a provider id is expected. Custom providers keep ids
 * open-ended, so this cannot reject every unknown string — the pinned
 * BUILTIN_PROVIDER_IDS set plus getProviderDef's runtime throw cover
 * the rest (see the registry tests).
 */
export type ProviderId = string & { readonly kind: "provider" };

export const BUILTIN_PROVIDER_IDS = [
	"deepseek",
	"deepseek-login",
	"deepseek-mac",
	"opencode-zen",
	"local-mlkit",
	"apple"
] as const;

export type BuiltinProviderId = (typeof BUILTIN_PROVIDER_IDS)[number];

/**
 * Name a built-in id: a typo'd literal fails to compile here instead of
 * throwing at runtime. Use only for the known ids above.
 */
export function builtin(id: BuiltinProviderId): ProviderId {
	return id as ProviderId;
}

/**
 * Trust boundary (persisted JSON, generated custom ids): the caller has
 * validated the string or generated it collision-free.
 */
export function asProviderId(id: string): ProviderId {
	return id as ProviderId;
}

export function isBuiltinProviderId(id: string): id is BuiltinProviderId {
	return (BUILTIN_PROVIDER_IDS as readonly string[]).includes(id);
}

export interface ProviderDef {
	id: ProviderId;
	label: string;
	defaultBaseUrl: string;
	defaultModel: string;
	/** Short hint shown under the key field. Never a real key. */
	keyHint: string;
	/** Keyless endpoints (on-device servers): no API key is needed or asked for. */
	keyless?: boolean;
	/** `GET /models` answers without a key (the list loads before one is set). */
	publicModels?: boolean;
	/** The API sends no CORS headers: no webview `fetch` can read it, so
	 * the app shell calls it from Rust (the web build can't at all). */
	browserBlocked?: boolean;
}

export const PROVIDERS: ProviderDef[] = [
	{
		id: builtin("deepseek"),
		label: "DeepSeek",
		defaultBaseUrl: "https://api.deepseek.com",
		defaultModel: DEEPSEEK_MODEL,
		keyHint: "Starts with sk-"
	},
	{
		// DeepSeek through llm.ccez.uk with the owner's key kept on the
		// server (functions/api/ai/deepseek, the Pages secret
		// DEEPSEEK_API_KEY): a browser he's logged in on needs no key.
		// The web build only; its login is Cloudflare Access.
		id: builtin("deepseek-login"),
		label: "DeepSeek (logged in)",
		defaultBaseUrl: "/api/ai/deepseek",
		defaultModel: DEEPSEEK_MODEL,
		keyHint: "your login on llm.ccez.uk",
		keyless: true
	},
	{
		// DeepSeek through ccez-words on the owner's Mac (z), which adds
		// the key it keeps in z's keychain: any device on the tailnet
		// needs no key of its own.
		id: builtin("deepseek-mac"),
		label: "DeepSeek (Mac)",
		defaultBaseUrl: DEEPSEEK_MAC_URL,
		defaultModel: DEEPSEEK_MODEL,
		keyHint: "ccez-words on the Mac adds the key",
		keyless: true
	},
	{
		id: builtin("opencode-zen"),
		label: "OpenCode Zen",
		defaultBaseUrl: ZEN_BASE_URL,
		defaultModel: "big-pickle",
		keyHint: "Zen key from opencode.ai/auth",
		publicModels: true,
		browserBlocked: true
	},
	{
		id: builtin("local-mlkit"),
		label: "ML Kit (on-device)",
		defaultBaseUrl: "http://localhost:11434/v1",
		defaultModel: "gemma4:latest",
		keyHint: "served on this device",
		keyless: true
	},
	{
		// Apple's on-device model (Apple Intelligence), served by
		// ccez-apple-llm on this Mac (or another one on the tailnet: change
		// the URL): free, private, offline on the Mac it runs on.
		id: builtin("apple"),
		label: "Apple (on-device)",
		defaultBaseUrl: "http://127.0.0.1:11546/v1",
		defaultModel: "apple-on-device",
		keyHint: "served by ccez-apple-llm on your Mac",
		keyless: true,
		publicModels: true
	}
];

/**
 * The provider a fresh install starts on: DeepSeek through the Mac on
 * desktop (keyless over the tailnet), through the site's login on the
 * web build, and with ccez-keys' key on Android.
 */
export function defaultProviderFor(platform: {
	shell: boolean;
	android: boolean;
}): ProviderId {
	if (platform.shell && platform.android) return builtin("deepseek");
	if (platform.shell) return builtin("deepseek-mac");
	return builtin("deepseek-login");
}

/** This runtime's default provider (see `defaultProviderFor`). */
export function platformDefaultProvider(): ProviderId {
	let android: boolean;
	try {
		android =
			typeof navigator !== "undefined" &&
			/android/i.test(navigator.userAgent ?? "");
	} catch {
		android = false;
	}
	return defaultProviderFor({ shell: tauriBackendAvailable(), android });
}

/** Built-ins plus user-added custom providers. */
export function listProviders(custom: ProviderDef[] = []): ProviderDef[] {
	return [...PROVIDERS, ...custom];
}

/**
 * Look up a def by id. The parameter stays a plain string on purpose:
 * this is the runtime validator for untrusted input (typo'd ids throw
 * instead of compiling — customs keep the set open).
 */
export function getProviderDef(
	id: string,
	custom: ProviderDef[] = []
): ProviderDef {
	const def = listProviders(custom).find((p) => p.id === id);
	if (!def) throw new Error(`Unknown provider: ${id}`);
	return def;
}

/**
 * Model-list behavior per built-in (defs stay plain data: custom
 * providers share the shape and persist as JSON). `pick` narrows and
 * orders a fetched list; `free` marks models that cost nothing.
 */
const MODEL_RULES: Partial<
	Record<
		BuiltinProviderId,
		{
			pick: (ids: readonly string[]) => string[];
			free: (id: string) => boolean;
		}
	>
> = {
	"opencode-zen": { pick: zenModelList, free: zenFreeModel }
};

function modelRules(id: string) {
	return isBuiltinProviderId(id) ? MODEL_RULES[id] : undefined;
}

/** A fetched model list as the picker offers it (others: as fetched). */
export function pickedModels(id: string, ids: readonly string[]): string[] {
	return modelRules(id)?.pick(ids) ?? [...ids];
}

/** Whether a model is free on its provider (false where unknown). */
export function isFreeModel(id: string, model: string): boolean {
	return modelRules(id)?.free(model) ?? false;
}

export function createProvider(
	id: string,
	opts: { baseUrl: string; apiKey: string; model: string; mobile?: boolean },
	custom: ProviderDef[] = []
): OpenAICompatProvider {
	const def = getProviderDef(id, custom); // throws on unknown ids
	return new OpenAICompatProvider(
		id,
		opts,
		def.browserBlocked && tauriBackendAvailable()
			? { listModelsNative: nativeModelList }
			: undefined
	);
}

/**
 * Whether a provider key is missing: blank on a
 * provider that needs one. Keyless on-device endpoints carry no
 * key by design. The conf-presence check stays at the call site
 * so narrowing keeps working.
 */
export function providerKeyMissing(apiKey: string, keyless: boolean): boolean {
	return !keyless && !apiKey.trim();
}
