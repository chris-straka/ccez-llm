import { OpenAICompatProvider } from "./openai-compat";
import { ZEN_BASE_URL, zenFreeModel, zenModelList } from "./zen";
import { tauriBackendAvailable } from "../secrets";

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
	"muse",
	"deepseek",
	"opencode-zen",
	"local-mlkit"
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
		id: builtin("muse"),
		label: "Muse",
		defaultBaseUrl: "https://api.meta.ai/v1",
		defaultModel: "muse-spark-1.3-contributor",
		keyHint: "Meta Model API key"
	},
	{
		id: builtin("deepseek"),
		label: "DeepSeek",
		defaultBaseUrl: "https://api.deepseek.com",
		defaultModel: "deepseek-flash",
		keyHint: "Starts with sk-"
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
	}
];

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
		{ pick: (ids: readonly string[]) => string[]; free: (id: string) => boolean }
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
