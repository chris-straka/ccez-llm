import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "./settings";

/**
 * Secret storage (Stage 7). Inside the Tauri shell, API keys live in the
 * macOS Keychain behind three Rust commands; everywhere else (web build,
 * browser preview, tests) the same interface falls back to an
 * AES-GCM-encrypted localStorage entry so the UI never branches.
 *
 * Web at-rest scheme: each value is AES-GCM-256 ciphertext
 * (`gcm1:` + JSON envelope with base64 iv/data) under the same
 * namespaced key. The data-encryption key is non-extractable and
 * persisted in IndexedDB (`ccez-keychain` / `keys` / `web-kek`), so a
 * casual disk/backup read of localStorage yields ciphertext, not keys.
 * Where IndexedDB is unavailable the key is an in-memory ephemeral
 * (ciphertext still avoids plaintext, but only decrypts this session).
 * Where WebCrypto itself is missing, values stay plaintext for
 * compatibility. Legacy plaintext entries (pre-encryption) keep reading
 * as-is and are re-encrypted on the next write.
 */

const FALLBACK_PREFIX = "ccez-keychain:";
/** Prefix marking an AES-GCM envelope (see above). */
const ENVELOPE_V1 = "gcm1:";

/**
 * Keychain identity shared with the Rust backend: the service name for
 * every `keychain_*` entry. Must stay identical to `KEYCHAIN_SERVICE`
 * in `src-tauri/src/lib.rs` and the bundle `identifier` in
 * `src-tauri/tauri.conf.json` (locked by the identity-stability test
 * below in `secrets.test.ts`). macOS looks stored secrets up by
 * service and gates them on the binary's code identity, so a service
 * drift silently orphans every stored API key — the same mass
 * re-prompt symptom as the ad-hoc dev-rebuild issue. Dev rebuilds
 * must be re-signed with the persistent local self-signed "Ccez Dev"
 * cert (`codesign -s`); that identity lives only on the dev machine
 * and is never committed. Automated by `scripts/tauri-dev.sh` (launch)
 * and `scripts/sign-dev-binary.sh` (re-sign after Rust rebuilds).
 */
export const KEYCHAIN_SERVICE = "studio.ccez.app";

export function secretAccount(providerId: string): string {
	return `provider:${providerId}`;
}

/**
 * One Keychain item for every provider key (instead of one item per
 * provider): macOS prompts once per item it cannot yet read, so N
 * providers meant N consecutive "wants to use your confidential
 * information" dialogs on every hydrate and every save. The bundle
 * holds canonical JSON (`{[providerId]: key}`, sorted keys,
 * non-empty values only). Legacy per-provider items are still read
 * once for migration (see `hydrateSecrets`) and then removed.
 */
export const SECRET_BUNDLE_ACCOUNT = "providers";

type SecretBundle = Record<string, string>;

/** Canonical bundle encoding: sorted keys so string comparison is stable. */
export function encodeSecretBundle(bundle: SecretBundle): string {
	const sorted: SecretBundle = {};
	for (const id of Object.keys(bundle).sort()) {
		const value = bundle[id];
		if (typeof value === "string" && value) sorted[id] = value;
	}
	return JSON.stringify(sorted);
}

/** Parse a stored bundle; corrupt or non-object payloads read as empty. */
export function decodeSecretBundle(raw: string | null): SecretBundle {
	if (!raw) return {};
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
			return {};
		const out: SecretBundle = {};
		for (const [id, value] of Object.entries(
			parsed as Record<string, unknown>
		)) {
			if (typeof value === "string" && value) out[id] = value;
		}
		return out;
	} catch {
		return {};
	}
}

/**
 * Last bundle value known to match secret storage (populated by
 * hydrate/persist). `persistSecrets` skips the write while the freshly
 * built bundle still equals this — an unchanged save touches no
 * Keychain item at all, so routine settings saves never re-prompt.
 * `undefined` means no hydrate has completed yet this session (see the
 * startup-race guard in `persistSecrets`).
 */
let lastKnownBundle: string | undefined = undefined;

/** Test-only reset for the write-skip cache above. */
export function resetSecretCacheForTests(): void {
	lastKnownBundle = undefined;
}

/** True inside the Tauri webview, where the Rust commands exist. */
export function tauriBackendAvailable(): boolean {
	try {
		if (typeof window === "undefined") return false;
		// Tauri v2 exposes __TAURI_INTERNALS__ (__TAURI__ was v1). Checking
		// only the v1 name silently disabled every tauri-gated branch in the
		// real app (traffic clearance, Keychain, shell UI).
		return (
			window.__TAURI_INTERNALS__ !== undefined || window.__TAURI__ !== undefined
		);
	} catch {
		return false;
	}
}

function fallbackStore(): Storage | null {
	try {
		if (typeof localStorage === "undefined") return null;
		return localStorage;
	} catch {
		return null;
	}
}

function webSubtle(): SubtleCrypto | null {
	try {
		const subtle = globalThis.crypto?.subtle ?? null;
		return subtle ?? null;
	} catch {
		return null;
	}
}

function bytesToB64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
	const binary = atob(b64);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
	return out;
}

function idbDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		try {
			if (typeof indexedDB === "undefined") throw new Error("no IndexedDB");
			const request = indexedDB.open("ccez-keychain", 1);
			request.onupgradeneeded = () => {
				if (!request.result.objectStoreNames.contains("keys")) {
					request.result.createObjectStore("keys");
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () =>
				reject(request.error ?? new Error("IndexedDB open failed"));
		} catch (error) {
			reject(error instanceof Error ? error : new Error(String(error)));
		}
	});
}

function idbGetKey(): Promise<CryptoKey | null> {
	return idbDatabase().then(
		(db) =>
			new Promise<CryptoKey | null>((resolve) => {
				try {
					const tx = db.transaction("keys", "readonly");
					const request = tx.objectStore("keys").get("web-kek");
					request.onsuccess = () => {
						db.close();
						resolve((request.result as CryptoKey | undefined) ?? null);
					};
					request.onerror = () => {
						db.close();
						resolve(null);
					};
				} catch {
					try {
						db.close();
					} catch {
						// Already closed.
					}
					resolve(null);
				}
			})
	);
}

function idbPutKey(key: CryptoKey): Promise<void> {
	return idbDatabase().then(
		(db) =>
			new Promise<void>((resolve) => {
				try {
					const tx = db.transaction("keys", "readwrite");
					tx.objectStore("keys").put(key, "web-kek");
					tx.oncomplete = () => {
						db.close();
						resolve();
					};
					tx.onerror = () => {
						db.close();
						resolve();
					};
				} catch {
					try {
						db.close();
					} catch {
						// Already closed.
					}
					resolve();
				}
			})
	);
}

let webKeyPromise: Promise<CryptoKey | null> | null = null;

/**
 * AES-GCM data key for the web fallback: the persisted non-extractable
 * IndexedDB key when available, else an in-memory ephemeral. Cached per
 * session; null where WebCrypto is missing (callers use plaintext).
 */
function webDataKey(): Promise<CryptoKey | null> {
	if (!webKeyPromise) {
		webKeyPromise = (async () => {
			const subtle = webSubtle();
			if (!subtle) return null;
			try {
				const stored = await idbGetKey();
				if (stored) return stored;
			} catch {
				// No IndexedDB (private mode, tests): ephemeral below.
			}
			try {
				const fresh = await subtle.generateKey(
					{ name: "AES-GCM", length: 256 },
					false,
					["encrypt", "decrypt"]
				);
				try {
					await idbPutKey(fresh);
				} catch {
					// Persistence failed: the key stays session-only.
				}
				return fresh;
			} catch {
				return null;
			}
		})();
	}
	return webKeyPromise;
}

async function fallbackGet(account: string): Promise<string | null> {
	let raw: string | null;
	try {
		raw = fallbackStore()?.getItem(FALLBACK_PREFIX + account) ?? null;
	} catch {
		return null;
	}
	if (!raw) return null;
	if (!raw.startsWith(ENVELOPE_V1)) return raw; // Legacy plaintext entry.
	const subtle = webSubtle();
	const key = await webDataKey();
	if (!subtle || !key) return null;
	try {
		const envelope = JSON.parse(raw.slice(ENVELOPE_V1.length)) as {
			iv: string;
			data: string;
		};
		const plain = await subtle.decrypt(
			{ name: "AES-GCM", iv: b64ToBytes(envelope.iv) },
			key,
			b64ToBytes(envelope.data)
		);
		return new TextDecoder().decode(plain);
	} catch {
		return null;
	}
}

async function fallbackSet(account: string, secret: string): Promise<void> {
	const store = fallbackStore();
	if (!store) return;
	let value = secret;
	const subtle = webSubtle();
	const key = await webDataKey();
	if (subtle && key) {
		try {
			const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
			const cipher = await subtle.encrypt(
				{ name: "AES-GCM", iv },
				key,
				new TextEncoder().encode(secret)
			);
			value =
				ENVELOPE_V1 +
				JSON.stringify({
					iv: bytesToB64(iv),
					data: bytesToB64(new Uint8Array(cipher))
				});
		} catch {
			value = secret;
		}
	}
	try {
		store.setItem(FALLBACK_PREFIX + account, value);
	} catch {
		// Private-mode storage failure: keys stay session-only.
	}
}

export async function getSecret(account: string): Promise<string | null> {
	if (tauriBackendAvailable()) {
		try {
			return await invoke<string | null>("keychain_get", { account });
		} catch {
			return null;
		}
	}
	return fallbackGet(account);
}

export async function setSecret(
	account: string,
	secret: string
): Promise<void> {
	if (tauriBackendAvailable()) {
		try {
			await invoke("keychain_set", { account, secret });
		} catch {
			// Locked keychain: the key stays session-only, like its siblings.
		}
		return;
	}
	await fallbackSet(account, secret);
}

export async function deleteSecret(account: string): Promise<void> {
	if (tauriBackendAvailable()) {
		try {
			await invoke("keychain_delete", { account });
		} catch {
			// Already gone or locked; the in-memory key is what matters.
		}
		return;
	}
	try {
		fallbackStore()?.removeItem(FALLBACK_PREFIX + account);
	} catch {
		// Nothing to clean up.
	}
}

/**
 * Fill blank in-memory provider keys from secret storage. Returns the ids
 * that were hydrated (so callers can re-render). Never throws.
 *
 * One stored read (the bundle), so at most one Keychain prompt at launch
 * no matter how many providers exist — never a per-provider fan-out.
 * Legacy per-provider items are NOT touched here; they migrate on demand
 * via migrateLegacySecret when their provider is actually used.
 */
export async function hydrateSecrets(settings: AppSettings): Promise<string[]> {
	const hydrated: string[] = [];
	try {
		const raw = await getSecret(SECRET_BUNDLE_ACCOUNT);
		if (raw !== null) {
			const bundle = decodeSecretBundle(raw);
			lastKnownBundle = encodeSecretBundle(bundle);
			for (const id of Object.keys(settings.providers)) {
				const entry = settings.providers[id];
				if (!entry) continue;
				if (entry.apiKey.trim()) continue;
				const secret = bundle[id];
				if (secret) {
					entry.apiKey = secret;
					hydrated.push(id);
				}
			}
			return hydrated;
		}
	} catch {
		// Locked keychain: the user types the key instead.
	}
	lastKnownBundle = encodeSecretBundle({});
	return hydrated;
}

/**
 * One legacy per-provider item, migrated the moment its provider is
 * actually used: read once, folded into the bundle, removed
 * best-effort. Returns true when a key was recovered. Never throws.
 * This is the only path that ever reads a legacy item, so upgraders
 * meet at most one prompt per legacy key, in context — never a
 * launch-time fan-out across providers they may never use.
 */
export async function migrateLegacySecret(
	settings: AppSettings,
	id: string
): Promise<boolean> {
	const entry = settings.providers[id];
	if (!entry || entry.apiKey.trim()) return false;
	let secret: string | null;
	try {
		secret = await getSecret(secretAccount(id));
	} catch {
		return false;
	}
	if (!secret) return false;
	entry.apiKey = secret;
	try {
		await deleteSecret(secretAccount(id));
	} catch {
		// Stale legacy item survives; it is ignored once the bundle
		// holds the key and re-migrates harmlessly if deleted.
	}
	try {
		await persistSecrets(settings);
	} catch {
		// Keychain locked: the key stays session-only.
	}
	return true;
}

/**
 * Mirror non-empty in-memory keys into secret storage. In the Tauri shell
 * the stored settings must then be saved blank (see `withBlankedKeys`);
 * in the browser the settings file keeps working as before.
 *
 * Writes only when the bundle actually changed (tracked since the last
 * hydrate/persist): saving an unrelated setting touches no Keychain
 * item, so it can never re-prompt. Before the first hydrate of the
 * session the stored bundle is compared instead, and an empty bundle
 * is never written over a stored one — a save racing startup must not
 * clobber keys hydrate has not read yet.
 */
export async function persistSecrets(settings: AppSettings): Promise<void> {
	const next: SecretBundle = {};
	for (const id of Object.keys(settings.providers)) {
		const key = settings.providers[id]?.apiKey.trim();
		if (key) next[id] = key;
	}
	const encoded = encodeSecretBundle(next);
	if (lastKnownBundle !== undefined) {
		if (encoded === lastKnownBundle) return;
	} else {
		try {
			const stored = await getSecret(SECRET_BUNDLE_ACCOUNT);
			if (
				stored !== null &&
				encodeSecretBundle(decodeSecretBundle(stored)) === encoded
			) {
				lastKnownBundle = encoded;
				return;
			}
			if (encoded === encodeSecretBundle({})) {
				// Nothing to save and nothing learned: leave storage (and
				// the cache) alone rather than writing an empty bundle.
				return;
			}
		} catch {
			// Locked keychain: the write below fails the same way, and
			// the blanked settings save drops the key — session-only.
		}
	}
	try {
		await setSecret(SECRET_BUNDLE_ACCOUNT, encoded);
		lastKnownBundle = encoded;
	} catch {
		// Keychain locked: nothing is stored, and the blanked settings
		// save below drops it — the key stays session-only.
	}
}

/** Copy of settings with provider keys blanked (Tauri shell persistence). */
export function withBlankedKeys(settings: AppSettings): AppSettings {
	const providers: AppSettings["providers"] = {};
	for (const [id, conf] of Object.entries(settings.providers)) {
		providers[id] = { ...conf, apiKey: "" };
	}
	return { ...settings, providers };
}
