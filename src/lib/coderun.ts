import { invoke } from "@tauri-apps/api/core";
import { tauriBackendAvailable } from "./secrets";

/**
 * Local Code Run (Code Runner style): a Run button on assistant code
 * blocks executes LOCALLY via the privileged `run_code` backend
 * command. Three runtimes, like every Tauri call: inside the shell
 * the backend runs it; in browser dev / jsdom the button stays
 * visible but reports a disabled-with-reason note — never a throw.
 */

/** Hard timeout, seconds. Mirrors `CODE_RUN_TIMEOUT_SECS` in `coderun.rs`. */
export const CODE_RUN_TIMEOUT_SECS = 10;

/** PATH-resolved runner for a fence label. Null = honest "no runner" note. */
export function runnerFor(
	language: string
): { program: string; suffix: string } | null {
	const lang = language.trim().toLowerCase();
	switch (lang) {
		case "python":
		case "py":
		case "python3":
			return { program: "python3", suffix: "py" };
		case "javascript":
		case "js":
		case "mjs":
		case "cjs":
		case "node":
			return { program: "node", suffix: "js" };
		case "typescript":
		case "ts":
			return { program: "bun", suffix: "ts" };
		case "bash":
		case "sh":
		case "shell":
			return { program: "bash", suffix: "sh" };
		case "ruby":
		case "rb":
			return { program: "ruby", suffix: "rb" };
		case "go":
		case "golang":
			return { program: "go", suffix: "go" };
		case "bun":
			return { program: "bun", suffix: "js" };
		case "deno":
			return { program: "deno", suffix: "js" };
		default:
			return null;
	}
}

/** Backend-shaped run result (mirrors `CodeRunResult` in `coderun.rs`). */
export interface CodeRunResult {
	exit_code: number | null;
	stdout: string;
	stderr: string;
	timed_out: boolean;
	truncated: boolean;
	cwd: string;
	command: string[];
}

/** What the Run button renders under the block. Never throws. */
export type CodeRunOutcome =
	| { kind: "ok"; result: CodeRunResult }
	| { kind: "unavailable"; reason: string };

/** Reason shown where the shell is missing (browser dev, jsdom, tests). */
export function codeRunDisabledReason(): string {
	return "Code Run needs the desktop app — snippets execute locally, and this preview has no local runner.";
}

/** Reason for fence labels with no PATH-resolved runner. */
export function noRunnerReason(language: string): string {
	const label = language.trim() || "text";
	return `No local runner for "${label}" — python, javascript, typescript (bun), bash, ruby, deno, and go run locally.`;
}

/**
 * Execute a fenced block locally. User-initiated clicks only (the
 * caller wires a real button press); this performs no network I/O.
 * Resolves `unavailable` outside the shell or for unknown
 * languages — never rejects into UI teardown.
 */
export async function runCodeBlock(
	language: string,
	code: string
): Promise<CodeRunOutcome> {
	// Pure mapping first: unknown labels report no-runner in every
	// runtime (including the backend-less preview), never a guess.
	const runner = runnerFor(language);
	if (!runner) return { kind: "unavailable", reason: noRunnerReason(language) };
	if (!tauriBackendAvailable())
		return { kind: "unavailable", reason: codeRunDisabledReason() };
	if (!code.trim())
		return {
			kind: "unavailable",
			reason: "Nothing to run — the block is empty."
		};
	try {
		const result = await invoke<CodeRunResult>("run_code", { language, code });
		return { kind: "ok", result };
	} catch (error) {
		return {
			kind: "unavailable",
			reason: error instanceof Error ? error.message : String(error)
		};
	}
}

/**
 * Tray text for a finished run: captured stdout/stderr only, never the
 * `Ran … (…snippet.py) — exit 0` header line (tmp-path and exit-0
 * noise). Silent runs yield "" so no tray renders; failures surface
 * through stderr, and never-ran outcomes keep their reason line.
 * Pure and unit-tested.
 */
export function codeRunBody(outcome: CodeRunOutcome): string {
	if (outcome.kind !== "ok") return codeRunSummary("text", outcome);
	return [outcome.result.stdout, outcome.result.stderr]
		.filter((part) => part.trim() !== "")
		.join("\n");
}

/** One-line summary stamped above captured output (`ran with …`). */
export function codeRunSummary(
	language: string,
	outcome: CodeRunOutcome
): string {
	if (outcome.kind === "unavailable") return outcome.reason;
	const { result } = outcome;
	if (result.timed_out)
		return `Timed out after ${CODE_RUN_TIMEOUT_SECS}s — the process was killed.`;
	const parts: string[] = [];
	parts.push(`exit ${result.exit_code ?? "?"}`);
	if (result.truncated) parts.push("output truncated at 64 KiB");
	if (!result.stdout.trim() && !result.stderr.trim()) parts.push("no output");
	return `Ran ${language.trim() || "text"} (${result.command.join(" ")}) — ${parts.join(" · ")}.`;
}
