/**
 * The Mac's menu bar Ask (owner, 2026-11-19: "a menu bar item for it so I
 * can click and ask a quick question and then have it answer back to me
 * in a notification and maybe the menu bar item icon changes so I can
 * click and see its response"). The small window (`/menubar`, made by
 * `menubar.rs`) shows the thread; the main window answers, the way the
 * game line leaves model calls to it: the chosen provider and key, the
 * reply streamed back over events, the thread filed as chat
 * `menubar-<id>`. An answer the owner isn't looking at marks the menu bar
 * icon and comes as a notification.
 *
 * Events: the window sends `menubar-ask` `{id, chat, messages}` (the whole
 * thread, the new question last) and `menubar-open` `{chat}`; the main
 * window answers with `menubar-delta` `{id, text}` (the next piece),
 * `menubar-retract` `{id}` (a tool round's text withdrawn), then
 * `menubar-done` `{id, text, cited}` or `menubar-failed` `{id, text}`.
 */
import type { ChatMessage, ChatProvider } from "./providers/types";
import { tauriBackendAvailable } from "./secrets";

export const MENUBAR_LABEL = "menubar";
export const MENUBAR_ASK_EVENT = "menubar-ask";
export const MENUBAR_OPEN_EVENT = "menubar-open";
export const MENUBAR_DELTA_EVENT = "menubar-delta";
export const MENUBAR_RETRACT_EVENT = "menubar-retract";
export const MENUBAR_DONE_EVENT = "menubar-done";
export const MENUBAR_FAILED_EVENT = "menubar-failed";
/** Chats asked from the menu bar (`importHomeAsks` with this prefix). */
export const MENUBAR_ASK_PREFIX = "menubar-";
/** A thread left this long starts over the next time the window opens. */
export const MENUBAR_RESET_MS = 5 * 60_000;

const SYSTEM =
	"The owner asks from the Mac's menu bar, for a quick answer: a few short sentences, plain text without markdown, in the language they ask in.";

export interface AskTurn {
	role: "user" | "assistant";
	content: string;
	/** An answer's sources, kept when the thread is filed again. */
	cited?: string[];
}

export interface MenubarAsk {
	id: number;
	chat: string;
	messages: AskTurn[];
}

/** The window's request, checked: null when anything is off. */
export function readAsk(payload: unknown): MenubarAsk | null {
	const p = payload as {
		id?: unknown;
		chat?: unknown;
		messages?: unknown;
	} | null;
	if (!p || typeof p.id !== "number" || !Number.isFinite(p.id)) return null;
	if (typeof p.chat !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(p.chat))
		return null;
	if (!Array.isArray(p.messages)) return null;
	const messages: AskTurn[] = [];
	for (const m of p.messages) {
		const mm = m as { role?: unknown; content?: unknown } | null;
		if (!mm || (mm.role !== "user" && mm.role !== "assistant")) continue;
		if (typeof mm.content !== "string" || mm.content.trim() === "") continue;
		const cited = (mm as { cited?: unknown }).cited;
		const urls = Array.isArray(cited)
			? cited.filter((u): u is string => typeof u === "string").slice(0, 20)
			: [];
		messages.push(
			mm.role === "assistant" && urls.length > 0
				? { role: mm.role, content: mm.content, cited: urls }
				: { role: mm.role, content: mm.content }
		);
	}
	if (messages.at(-1)?.role !== "user") return null;
	return { id: p.id, chat: p.chat, messages };
}

/** What the provider gets: a line on where it was asked, then the thread. */
export function askMessages(thread: AskTurn[]): ChatMessage[] {
	return [
		{ role: "system", content: SYSTEM },
		...thread.map((m) => ({ role: m.role, content: m.content }))
	];
}

/** The thread as the window holds it, for the next question. */
export function threadFor(
	turns: {
		q: string;
		a: string;
		cited?: string[];
		failed: string;
		done: boolean;
	}[]
): AskTurn[] {
	const out: AskTurn[] = [];
	turns.forEach((t, i) => {
		out.push({ role: "user", content: t.q });
		const last = i === turns.length - 1;
		if (!last && t.done && !t.failed && t.a.trim())
			out.push(
				t.cited?.length
					? { role: "assistant", content: t.a, cited: t.cited }
					: { role: "assistant", content: t.a }
			);
	});
	// A question whose answer failed or never came is asked again, not twice.
	return out.filter(
		(m, i) => !(m.role === "user" && out[i + 1]?.role === "user")
	);
}

/** A source as a short name: its site, without www (and a long host's
 * last three parts). */
export function siteName(url: string): string {
	try {
		const parts = new URL(url).hostname.replace(/^www\./, "").split(".");
		return parts.slice(-3).join(".");
	} catch {
		return url;
	}
}

/** One address per site, in order (answers cite a site's pages twice). */
export function oneASite(urls: string[]): string[] {
	const seen: string[] = [];
	return urls.filter((u) => {
		const site = siteName(u);
		if (seen.includes(site)) return false;
		seen.push(site);
		return true;
	});
}

/** One line for a notification: no markdown marks, cut at a word. */
export function notificationText(text: string, max = 180): string {
	const plain = text
		.replace(/[*_`#>]+/g, "")
		.replace(/\s+/g, " ")
		.trim();
	if (plain.length <= max) return plain;
	const cut = plain.slice(0, max);
	const space = cut.lastIndexOf(" ");
	return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** A failure in words for the window. */
export function failureText(error: unknown): string {
	const name = (error as { name?: unknown } | null)?.name;
	const message = error instanceof Error ? error.message : String(error);
	if (name === "AbortError" || /abort/i.test(message)) return "Stopped.";
	return message.trim() || "No answer came.";
}

/** A new thread's id (the chat becomes `menubar-<id>`). */
export function newAskChatId(): string {
	return (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`).slice(0, 36);
}

export interface MenubarDeps {
	/** The chosen provider with its key; null without one. */
	resolve: () => ChatProvider | null;
	/** File the whole thread (answer last) as chat `menubar-<chat>`. */
	save: (chat: string, thread: AskTurn[], cited: string[]) => void;
	/** Open chat `menubar-<chat>` in this window. */
	open: (chatId: string) => void;
}

/** Answers one request; `to` sends an event to the Ask window. */
export async function answerAsk(
	ask: MenubarAsk,
	deps: Pick<MenubarDeps, "resolve" | "save">,
	to: (event: string, payload: unknown) => void,
	signal?: AbortSignal
): Promise<{ answer: string } | { failed: string }> {
	const provider = deps.resolve();
	if (!provider) {
		const failed = "No key for the chosen provider: add one in Settings.";
		to(MENUBAR_FAILED_EVENT, { id: ask.id, text: failed });
		return { failed };
	}
	let streamed = "";
	try {
		const result = await provider.stream(
			askMessages(ask.messages),
			{
				onToken: (text) => {
					streamed += text;
					to(MENUBAR_DELTA_EVENT, { id: ask.id, text });
				},
				onRoundRetract: () => {
					streamed = "";
					to(MENUBAR_RETRACT_EVENT, { id: ask.id });
				}
			},
			{ signal }
		);
		const answer = (result.content || streamed).trim();
		if (!answer) throw new Error("No answer came.");
		const cited = result.cited ?? [];
		to(MENUBAR_DONE_EVENT, { id: ask.id, text: answer, cited });
		deps.save(
			ask.chat,
			[...ask.messages, { role: "assistant", content: answer }],
			cited
		);
		return { answer };
	} catch (error) {
		const failed = failureText(error);
		to(MENUBAR_FAILED_EVENT, { id: ask.id, text: failed });
		return { failed };
	}
}

/** Serves the menu bar's questions (the Mac shell's main window only). */
export async function serveMenubarAsk(deps: MenubarDeps): Promise<void> {
	if (!tauriBackendAvailable()) return;
	try {
		const { listen, emitTo } = await import("@tauri-apps/api/event");
		const { invoke } = await import("@tauri-apps/api/core");
		const to = (event: string, payload: unknown): void => {
			void emitTo(MENUBAR_LABEL, event, payload).catch(() => undefined);
		};
		await listen(MENUBAR_ASK_EVENT, (event) => {
			const ask = readAsk(event.payload);
			if (!ask) return;
			void answerAsk(ask, deps, to).then(async (outcome) => {
				// Looked at already: nothing more. Otherwise the icon takes
				// its dot (menubar.rs) and a notification says it.
				const seen = await invoke<boolean>("menubar_answered").catch(
					() => true
				);
				if (seen) return;
				const question = ask.messages.at(-1)?.content ?? "";
				await notify(
					notificationText(question, 60),
					"answer" in outcome
						? notificationText(outcome.answer)
						: outcome.failed
				);
			});
		});
		await listen<{ chat?: unknown }>(MENUBAR_OPEN_EVENT, (event) => {
			const chat = event.payload?.chat;
			if (typeof chat !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(chat))
				return;
			deps.open(`${MENUBAR_ASK_PREFIX}${chat}`);
			void invoke("menubar_open_main").catch(() => undefined);
		});
	} catch {
		// No shell events here (web, tests): nothing to serve.
	}
}

async function notify(title: string, body: string): Promise<void> {
	try {
		const { invoke } = await import("@tauri-apps/api/core");
		// Debug builds (drive scripts) keep it for the script to read
		// instead: no permission prompt on the owner's screen.
		if (
			await invoke("drive_ready").then(
				() => true,
				() => false
			)
		) {
			(
				globalThis as unknown as { __ccezLastNotification?: unknown }
			).__ccezLastNotification = { title, body };
			return;
		}
		const n = await import("@tauri-apps/plugin-notification");
		let granted = await n.isPermissionGranted();
		if (!granted) granted = (await n.requestPermission()) === "granted";
		if (granted) n.sendNotification({ title, body });
	} catch {
		// No notifications: the icon's dot still says it.
	}
}
