/**
 * Where listening drills get their videos: the app's own Rust backend
 * (`listen_*` commands), which talks to YouTube directly on desktop
 * and phone alike. The plain web build has none (YouTube refuses
 * browser pages), so drills are an app feature.
 */

import type {
	ListenChannelPage,
	ListenEntry,
	ListenFetched,
	ListenVideo
} from "./listen";

export interface ListenBackend {
	search: (query: string, kind: "video" | "channel") => Promise<ListenEntry[]>;
	channel: (ref: string) => Promise<ListenChannelPage>;
	videos: (ids: string[], lang: string) => Promise<ListenVideo[]>;
	fetch: (id: string, lang: string) => Promise<ListenFetched>;
	/** The fetched track's bytes (call after `fetch`). */
	audio: (id: string, lang: string) => Promise<ArrayBuffer>;
}

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

export function shellBackend(invoke: Invoke): ListenBackend {
	return {
		search: (query, kind) =>
			invoke<ListenEntry[]>("listen_search", { query, kind }),
		channel: (reference) =>
			invoke<ListenChannelPage>("listen_channel", { reference }),
		videos: (ids, lang) =>
			invoke<ListenVideo[]>("listen_videos", { ids, lang }),
		fetch: (id, lang) => invoke<ListenFetched>("listen_fetch", { id, lang }),
		audio: (id, lang) => invoke<ArrayBuffer>("listen_audio", { id, lang })
	};
}
