/**
 * Where listening drills get their videos. The desktop shell runs
 * yt-dlp itself (Rust `listen_*` commands); the phone and the web
 * build ask the learner's own clip server (`ccez-listen serve`,
 * reachable on their tailnet only). Both speak the same shapes.
 */

import type { ListenChannelPage, ListenEntry, ListenFetched, ListenVideo } from "./listen";

export interface ListenBackend {
	readonly kind: "shell" | "server";
	search(query: string, kind: "video" | "channel"): Promise<ListenEntry[]>;
	channel(ref: string): Promise<ListenChannelPage>;
	videos(ids: string[], lang: string): Promise<ListenVideo[]>;
	fetch(id: string, lang: string): Promise<ListenFetched>;
	/** The fetched track's bytes (call after `fetch`). */
	audio(id: string, lang: string): Promise<ArrayBuffer>;
}

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/** Desktop shell: yt-dlp on this machine. */
export function shellBackend(invoke: Invoke): ListenBackend {
	return {
		kind: "shell",
		search: (query, kind) => invoke<ListenEntry[]>("listen_search", { query, kind }),
		channel: (reference) => invoke<ListenChannelPage>("listen_channel", { reference }),
		videos: (ids, lang) => invoke<ListenVideo[]>("listen_videos", { ids, lang }),
		fetch: (id, lang) => invoke<ListenFetched>("listen_fetch", { id, lang }),
		audio: (id, lang) => invoke<ArrayBuffer>("listen_audio", { id, lang })
	};
}

/** Normalize a typed server address: scheme added, slashes trimmed. */
export function normalizeServer(raw: string): string {
	const s = raw.trim().replace(/\/+$/, "");
	if (!s) return "";
	return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

async function readJson<T>(response: Response): Promise<T> {
	if (!response.ok) {
		let code = `listen-http-${response.status}`;
		try {
			const body = (await response.json()) as { error?: unknown };
			if (typeof body.error === "string") code = body.error;
		} catch {
			// Not JSON: keep the status code.
		}
		throw new Error(code);
	}
	return (await response.json()) as T;
}

/** The learner's clip server over HTTP. */
export function serverBackend(base: string, fetchImpl: typeof fetch = fetch): ListenBackend {
	const root = normalizeServer(base);
	const get = async <T>(path: string, params: Record<string, string>): Promise<T> => {
		const url = `${root}/v1/${path}?${new URLSearchParams(params).toString()}`;
		return readJson<T>(await fetchImpl(url));
	};
	return {
		kind: "server",
		search: (q, kind) => get<ListenEntry[]>("search", { q, kind }),
		channel: (ref) => get<ListenChannelPage>("channel", { ref }),
		videos: (ids, lang) => get<ListenVideo[]>("videos", { ids: ids.join(","), lang }),
		fetch: (id, lang) => get<ListenFetched>("fetch", { id, lang }),
		audio: async (id, lang) => {
			const url = `${root}/v1/audio?${new URLSearchParams({ id, lang }).toString()}`;
			const response = await fetchImpl(url);
			if (!response.ok) await readJson(response);
			return response.arrayBuffer();
		}
	};
}

/**
 * The backend for this runtime: the shell's own yt-dlp on desktop
 * (falling back to the server when yt-dlp is missing and a server is
 * set), the server elsewhere, or null when neither exists.
 */
export function pickBackend(opts: {
	desktopShell: boolean;
	server: string;
	invoke: Invoke | null;
	fetchImpl?: typeof fetch;
}): ListenBackend | null {
	const server = normalizeServer(opts.server);
	const remote = server ? serverBackend(server, opts.fetchImpl) : null;
	if (opts.desktopShell && opts.invoke) {
		const local = shellBackend(opts.invoke);
		if (!remote) return local;
		const fallback =
			<A extends unknown[], R>(f: (...a: A) => Promise<R>, g: (...a: A) => Promise<R>) =>
			async (...a: A): Promise<R> => {
				try {
					return await f(...a);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					if (message.includes("listen-no-ytdlp")) return g(...a);
					throw error;
				}
			};
		return {
			kind: "shell",
			search: fallback(local.search, remote.search),
			channel: fallback(local.channel, remote.channel),
			videos: fallback(local.videos, remote.videos),
			fetch: fallback(local.fetch, remote.fetch),
			audio: fallback(local.audio, remote.audio)
		};
	}
	return remote;
}
