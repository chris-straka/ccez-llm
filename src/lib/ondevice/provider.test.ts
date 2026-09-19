import { describe, it, expect, vi } from "vitest";
import {
	firstUrl,
	formatOnDevicePrompt,
	OnDeviceChatProvider
} from "./provider";
import type { OnDeviceDeps } from "./bridge";

function depsWith(result: unknown): {
	deps: OnDeviceDeps;
	invoke: ReturnType<typeof vi.fn>;
} {
	const invoke = vi.fn(async () => result);
	return { deps: { shell: true, invoke }, invoke };
}

describe("formatOnDevicePrompt", () => {
	it("leads with the system prompt, then role-labeled turns", () => {
		expect(
			formatOnDevicePrompt([
				{ role: "system", content: "Be brief." },
				{ role: "user", content: "hi" },
				{ role: "assistant", content: "hey" },
				{ role: "user", content: "more" }
			])
		).toBe("Be brief.\n\nuser: hi\n\nassistant: hey\n\nuser: more");
	});

	it("drops empty turns and reads image parts as text", () => {
		expect(
			formatOnDevicePrompt([
				{ role: "user", content: "   " },
				{
					role: "user",
					content: [
						{ type: "text", text: "look" },
						{ type: "image_url", image_url: { url: "data:x" } }
					]
				}
			])
		).toBe("user: look");
	});

	it("joins nothing into an empty prompt", () => {
		expect(formatOnDevicePrompt([])).toBe("");
	});
});

describe("OnDeviceChatProvider", () => {
	it("sends the flattened prompt and reports no usage", async () => {
		const { deps, invoke } = depsWith("done");
		const provider = new OnDeviceChatProvider(deps);
		expect(provider.id).toBe("local-gemma");
		const result = await provider.chat([{ role: "user", content: "hi" }]);
		expect(result).toEqual({ content: "done", usage: null });
		expect(invoke).toHaveBeenCalledWith("ondevice_generate", {
			prompt: "user: hi",
			maxTokens: 512
		});
	});

	it("streams the whole completion through one token call", async () => {
		const { deps } = depsWith("full text");
		const provider = new OnDeviceChatProvider(deps);
		const tokens: string[] = [];
		const result = await provider.stream([{ role: "user", content: "hi" }], {
			onToken: (text) => tokens.push(text)
		});
		expect(tokens).toEqual(["full text"]);
		expect(result.content).toBe("full text");
	});

	it("rejects an aborted stop with the stopped copy", async () => {
		const { deps, invoke } = depsWith("late");
		const provider = new OnDeviceChatProvider(deps);
		const controller = new AbortController();
		controller.abort();
		await expect(
			provider.chat([{ role: "user", content: "hi" }], {
				signal: controller.signal
			})
		).rejects.toThrow("On-device reply stopped.");
		expect(invoke).not.toHaveBeenCalled();
	});

	it("surfaces native failures as the short copy", async () => {
		const invoke = vi.fn(async () => {
			throw new Error("downloading");
		});
		const provider = new OnDeviceChatProvider({ shell: true, invoke });
		await expect(
			provider.chat([{ role: "user", content: "hi" }])
		).rejects.toThrow(
			"On-device model is still downloading. Try again in a bit."
		);
	});
});

describe("firstUrl", () => {
	it("finds the first link and nothing else", () => {
		expect(
			firstUrl("read https://example.com/a and https://example.com/b")
		).toBe("https://example.com/a");
		expect(firstUrl("no links here")).toBe(null);
		expect(firstUrl("")).toBe(null);
	});
});

describe("OnDeviceChatProvider URL fallback", () => {
	it("fetches a shared URL into context", async () => {
		const { deps, invoke } = depsWith("done");
		const fetchPage = vi.fn(async (url: string) => `text of ${url}`);
		const provider = new OnDeviceChatProvider({ ...deps, fetchPage });
		const result = await provider.chat([
			{ role: "user", content: "read https://example.com/x" }
		]);
		expect(result.content).toBe("done");
		expect(fetchPage).toHaveBeenCalledOnce();
		expect(invoke).toHaveBeenCalledWith("ondevice_generate", {
			prompt:
				"user: read https://example.com/x\n\nuser: Fetched page text for https://example.com/x:\ntext of https://example.com/x",
			maxTokens: 512
		});
	});

	it("falls back to plain history when the fetch fails", async () => {
		const { deps, invoke } = depsWith("done");
		const fetchPage = vi.fn(async () => {
			throw new Error("offline");
		});
		const provider = new OnDeviceChatProvider({ ...deps, fetchPage });
		const result = await provider.chat([
			{ role: "user", content: "read https://example.com/x" }
		]);
		expect(result.content).toBe("done");
		expect(invoke).toHaveBeenCalledWith("ondevice_generate", {
			prompt: "user: read https://example.com/x",
			maxTokens: 512
		});
	});
});
