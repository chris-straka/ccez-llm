#!/usr/bin/env bun
/**
 * The agent API from a terminal: asks the running app (`agent.rs`,
 * `src/lib/agent.ts`) and prints what comes back. Off the record: no chat
 * is touched. The app answers through `agent.sock` in its data folder,
 * which only the owner's account can open.
 *
 *   bun scripts/llm.ts status
 *   bun scripts/llm.ts ask "text" [--provider apple]
 *   bun scripts/llm.ts annotate "word or phrase" [--in "sentence"] [--lang fr] [--question "…"] [--provider id]
 *   bun scripts/llm.ts lookup "word" --lang fr   (the installed dictionary's hits)
 *   bun scripts/llm.ts settings get|set …      (scripts/settings.ts)
 *   --dev  the dev app (Ccez LLM Dev);  --json  every line as it comes
 */
import { homedir, platform } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
	const i = argv.indexOf(name);
	if (i < 0) return undefined;
	const v = argv[i + 1];
	argv.splice(i, 2);
	return v;
};
const has = (name: string): boolean => {
	const i = argv.indexOf(name);
	if (i < 0) return false;
	argv.splice(i, 1);
	return true;
};

const dev = has("--dev");
const whole = has("--whole");
const json = has("--json");
// Options first: what's left is the command and its words.
const opts = {
	provider: flag("--provider"),
	lang: flag("--lang"),
	context: flag("--in"),
	question: flag("--question")
};
const [cmd, ...rest] = argv;

if (!cmd || cmd === "help" || cmd === "--help") {
	console.log(
		'usage: llm status | ask "text" [--provider id] | annotate "quote" [--in "sentence"] [--lang xx] [--question "…"] | settings …  [--dev] [--json]'
	);
	process.exit(cmd ? 0 : 2);
}

if (cmd === "settings") {
	const child = Bun.spawn(
		[
			"bun",
			join(import.meta.dir, "settings.ts"),
			...(dev ? ["--dev"] : []),
			...rest
		],
		{
			stdout: "inherit",
			stderr: "inherit"
		}
	);
	process.exit(await child.exited);
}

const id = dev ? "studio.ccez.app.dev" : "studio.ccez.app";
const dataDir =
	platform() === "darwin"
		? join(homedir(), "Library/Application Support", id)
		: join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share"), id);
const sock = join(dataDir, "agent.sock");

let args: Record<string, unknown> = {};
if (cmd === "ask")
	args = { text: rest.join(" "), provider: opts.provider, whole };
else if (cmd === "lookup") args = { quote: rest.join(" "), lang: opts.lang };
else if (cmd === "annotate") args = { quote: rest.join(" "), ...opts };

type Line = {
	done?: boolean;
	error?: string;
	result?: { answer?: string; provider?: string } & Record<string, unknown>;
	token?: string;
	partial?: { answer?: string };
	ms?: number;
};

let buf = "";
let exitCode = 0;
let streamed = false;
const done = Promise.withResolvers<void>();

const show = (line: Line): void => {
	if (json) {
		console.log(JSON.stringify(line));
		return;
	}
	if (line.token !== undefined) {
		process.stdout.write(line.token);
		streamed = true;
	} else if (line.partial) {
		console.log(`[${line.ms} ms, first]\n${line.partial.answer ?? ""}\n`);
	} else if (line.done) {
		if (line.error) {
			console.error(`error: ${line.error}`);
			exitCode = 1;
		} else if (cmd === "status" || cmd === "lookup") {
			console.log(JSON.stringify(line.result, null, 2));
		} else {
			if (!streamed) console.log(line.result?.answer ?? "");
			console.log(`\n[${line.ms} ms, ${line.result?.provider ?? "?"}]`);
		}
	}
};

try {
	await Bun.connect({
		unix: sock,
		socket: {
			open(s) {
				s.write(JSON.stringify({ cmd, args }) + "\n");
			},
			data(_s, data) {
				buf += new TextDecoder().decode(data);
				let nl: number;
				while ((nl = buf.indexOf("\n")) >= 0) {
					const raw = buf.slice(0, nl);
					buf = buf.slice(nl + 1);
					if (!raw.trim()) continue;
					try {
						const line = JSON.parse(raw) as Line;
						show(line);
						if (line.done) done.resolve();
					} catch {
						console.log(raw);
					}
				}
			},
			close() {
				done.resolve();
			},
			error() {
				done.resolve();
			}
		}
	});
} catch {
	console.error(
		`The app isn't running${dev ? " (dev)" : ""}, or is older than the agent API (no ${sock}).`
	);
	process.exit(1);
}
await done.promise;
process.exit(exitCode);
