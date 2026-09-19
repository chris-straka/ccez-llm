import { describe, expect, it } from "vitest";
import {
	CODE_RUN_TIMEOUT_SECS,
	codeRunBody,
	codeRunDisabledReason,
	codeRunSummary,
	noRunnerReason,
	runnerFor,
	runCodeBlock
} from "./coderun";

describe("runnerFor", () => {
	it("maps the obvious fence labels to PATH runners", () => {
		expect(runnerFor("python")).toEqual({ program: "python3", suffix: "py" });
		expect(runnerFor("py")).toEqual({ program: "python3", suffix: "py" });
		expect(runnerFor("javascript")).toEqual({ program: "node", suffix: "js" });
		expect(runnerFor("js")).toEqual({ program: "node", suffix: "js" });
		expect(runnerFor("typescript")).toEqual({ program: "bun", suffix: "ts" });
		expect(runnerFor("ts")).toEqual({ program: "bun", suffix: "ts" });
		expect(runnerFor("bash")).toEqual({ program: "bash", suffix: "sh" });
		expect(runnerFor("sh")).toEqual({ program: "bash", suffix: "sh" });
		expect(runnerFor("ruby")).toEqual({ program: "ruby", suffix: "rb" });
		expect(runnerFor("deno")).toEqual({ program: "deno", suffix: "js" });
		expect(runnerFor("go")).toEqual({ program: "go", suffix: "go" });
		expect(runnerFor("golang")).toEqual({ program: "go", suffix: "go" });
	});

	it("is case- and whitespace-tolerant", () => {
		expect(runnerFor("  PY  ")).toEqual({ program: "python3", suffix: "py" });
		expect(runnerFor("JS")).toEqual({ program: "node", suffix: "js" });
	});

	it("returns null for unknown languages — never a guess", () => {
		expect(runnerFor("haskell")).toBeNull();
		expect(runnerFor("")).toBeNull();
		expect(runnerFor("text")).toBeNull();
		expect(noRunnerReason("haskell")).toContain(
			'No local runner for "haskell"'
		);
	});
});

describe("timeout", () => {
	it("matches the backend CODE_RUN_TIMEOUT_SECS (10s)", () => {
		expect(CODE_RUN_TIMEOUT_SECS).toBe(10);
	});
});

describe("runCodeBlock outside the shell", () => {
	it("resolves unavailable with a reason — never throws", async () => {
		// jsdom/node has no Tauri internals, so this rides the fallback.
		const outcome = await runCodeBlock("python", "print('hi')");
		expect(outcome.kind).toBe("unavailable");
		if (outcome.kind === "unavailable")
			expect(outcome.reason).toContain("desktop app");
	});

	it("reports unknown languages without touching the backend", async () => {
		// Mapping is checked before the shell: the no-runner note wins
		// in every runtime, including this backend-less one.
		const outcome = await runCodeBlock("haskell", "main = return ()");
		expect(outcome.kind).toBe("unavailable");
		if (outcome.kind === "unavailable")
			expect(outcome.reason).toContain("No local runner");
		expect(runnerFor("haskell")).toBeNull();
		expect(noRunnerReason("haskell")).toContain("No local runner");
	});

	it("rejects empty blocks", async () => {
		const outcome = await runCodeBlock("python", "   ");
		expect(outcome.kind).toBe("unavailable");
	});
});

describe("codeRunSummary", () => {
	it("summarizes ok / timeout / unavailable outcomes", () => {
		expect(
			codeRunSummary("python", {
				kind: "ok",
				result: {
					exit_code: 0,
					stdout: "hi\n",
					stderr: "",
					timed_out: false,
					truncated: false,
					cwd: "/tmp/x",
					command: ["python3", "/tmp/x/snippet.py"]
				}
			})
		).toContain("exit 0");
		expect(
			codeRunSummary("python", {
				kind: "ok",
				result: {
					exit_code: null,
					stdout: "",
					stderr: "",
					timed_out: true,
					truncated: false,
					cwd: "/tmp/x",
					command: ["python3", "/tmp/x/snippet.py"]
				}
			})
		).toContain("Timed out after 10s");
		expect(
			codeRunSummary("python", { kind: "unavailable", reason: "nope" })
		).toBe("nope");
		expect(codeRunDisabledReason()).toContain("desktop app");
	});
});

describe("codeRunBody", () => {
	const result = {
		exit_code: 0,
		timed_out: false,
		truncated: false,
		cwd: "/tmp/x",
		command: ["python3", "/tmp/x/snippet.py"]
	};
	it("stamps output with no header line", () => {
		expect(
			codeRunBody({
				kind: "ok",
				result: { ...result, stdout: "Hello, world!\n", stderr: "" }
			})
		).toBe("Hello, world!\n");
		expect(
			codeRunBody({
				kind: "ok",
				result: { ...result, stdout: "out\n", stderr: "warn\n" }
			})
		).toBe("out\n\nwarn\n");
	});

	it("is empty for silent runs so no tray renders", () => {
		expect(
			codeRunBody({
				kind: "ok",
				result: { ...result, stdout: "", stderr: "  \n" }
			})
		).toBe("");
	});

	it("keeps the reason for never-ran outcomes", () => {
		expect(codeRunBody({ kind: "unavailable", reason: "nope" })).toBe("nope");
	});
});
