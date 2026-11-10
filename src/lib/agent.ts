/**
 * The agent API, window side (`src-tauri/src/agent.rs`, `scripts/llm.ts`):
 * a command from the owner's agents arrives as an `agent-request` event;
 * the answer streams back line by line through `agent_reply`, ending with
 * one that carries `done`. Off the record: `ask` and `annotate` touch no
 * chat (`lookup` reads the dictionary as a card would). Pure except `serveAgent` (the shell wiring), so the commands test
 * without a window.
 */
import type { AnnotationQuestion, AnnotationReply } from "./reading";
import type { ChatProvider } from "./providers/types";
import { tauriBackendAvailable } from "./secrets";

export interface AgentDeps {
	/** A provider by id (the active one when absent); null without a key. */
	resolve: (providerId?: string) => ChatProvider | null;
	/** A note's answer, as `A` gets it (dictionary card first, then the model's). */
	annotate: (
		provider: ChatProvider,
		q: AnnotationQuestion,
		signal: AbortSignal,
		onPartial: (reply: AnnotationReply) => void
	) => Promise<AnnotationReply>;
	status: () => Record<string, unknown>;
	/** The installed dictionary's hits for a word (null: no pack). */
	lookup?: (quote: string, lang: string) => Promise<unknown>;
}

export type AgentLine = Record<string, unknown>;

function text(v: unknown): string | undefined {
	return typeof v === "string" && v.trim() ? v : undefined;
}

/** Runs one command; streams lines through `send`; resolves the result. */
export async function handleAgent(
	cmd: string,
	args: unknown,
	deps: AgentDeps,
	send: (line: AgentLine) => void,
	signal: AbortSignal = new AbortController().signal
): Promise<unknown> {
	const a = (args && typeof args === "object" ? args : {}) as Record<
		string,
		unknown
	>;
	const providerOf = (): ChatProvider => {
		const id = text(a.provider);
		const p = deps.resolve(id);
		if (!p) throw new Error(`No key for ${id ?? "the active provider"}.`);
		return p;
	};
	switch (cmd) {
		case "status":
			return deps.status();
		case "ask": {
			const question = text(a.text);
			if (!question) throw new Error("ask needs text.");
			const provider = providerOf();
			const messages = [{ role: "user" as const, content: question }];
			// --whole: one answer at the end, the way notes ask.
			send({ stage: "calling" });
			const result =
				a.whole === true
					? await provider.chat(messages, { signal })
					: await provider.stream(
							messages,
							{ onToken: (token) => send({ token }) },
							{ signal }
						);
			send({ stage: "returned", length: result.content.length });
			return { provider: provider.id, answer: result.content };
		}
		case "annotate": {
			const quote = text(a.quote);
			if (!quote) throw new Error("annotate needs a word or phrase.");
			const provider = providerOf();
			const q: AnnotationQuestion = {
				quote,
				question: text(a.question) ?? "",
				context: text(a.context) ?? quote,
				lang: text(a.lang) ?? null
			};
			const reply = await deps.annotate(provider, q, signal, (partial) =>
				send({ partial })
			);
			return { provider: provider.id, ...reply };
		}
		case "lookup": {
			const quote = text(a.quote);
			const lang = text(a.lang);
			if (!quote || !lang) throw new Error("lookup needs a word and --lang.");
			if (!deps.lookup) throw new Error("No dictionaries here.");
			return await deps.lookup(quote, lang);
		}
		default:
			throw new Error(`No command "${cmd}" (status, ask, annotate, lookup).`);
	}
}

/** Listens for the agent API's requests (the desktop shell only). */
export async function serveAgent(deps: AgentDeps): Promise<void> {
	if (!tauriBackendAvailable()) return;
	try {
		const { listen } = await import("@tauri-apps/api/event");
		const { invoke } = await import("@tauri-apps/api/core");
		await listen<{ id: number; cmd: string; args: unknown }>(
			"agent-request",
			(event) => {
				const { id, cmd, args } = event.payload;
				const t0 = performance.now();
				const reply = (line: AgentLine): void => {
					const ms = Math.round(performance.now() - t0);
					void invoke("agent_reply", {
						id,
						line: JSON.stringify({ ...line, ms })
					}).catch(() => undefined);
				};
				handleAgent(cmd, args, deps, reply).then(
					(result) => reply({ done: true, result }),
					(error: unknown) =>
						reply({
							done: true,
							error: error instanceof Error ? error.message : String(error)
						})
				);
			}
		);
	} catch {
		// No shell events here (web, tests): nothing to serve.
	}
}
