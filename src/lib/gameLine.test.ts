import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearGameLineCache,
	gameLineCached,
	gameLineTranslationMessages,
	translateGameLine
} from "./gameLine";
import type { ChatProvider } from "./providers/types";

function providerFor(content: string): Pick<ChatProvider, "chat"> {
	const chat = vi.fn().mockResolvedValue({
		content,
		usage: { prompt: 1, completion: 1, total: 2 }
	});
	return { chat: chat as ChatProvider["chat"] };
}

describe("gameLineTranslationMessages", () => {
	it("asks for the translation alone", () => {
		const [system, user] = gameLineTranslationMessages("行くぞ！");
		expect(system?.role).toBe("system");
		expect(system?.content).toContain("one line");
		expect(user).toEqual({ role: "user", content: "行くぞ！" });
	});
});

describe("translateGameLine", () => {
	beforeEach(() => {
		clearGameLineCache();
	});

	it("calls once per line, caching the trimmed text", async () => {
		const provider = providerFor("  Let's go!  ");
		await expect(translateGameLine(provider, "行くぞ！")).resolves.toBe(
			"Let's go!"
		);
		await expect(translateGameLine(provider, "  行くぞ！\n")).resolves.toBe(
			"Let's go!"
		);
		expect(provider.chat).toHaveBeenCalledTimes(1);
		expect(provider.chat).toHaveBeenCalledWith(
			gameLineTranslationMessages("行くぞ！")
		);
		expect(gameLineCached("行くぞ！")).toBe("Let's go!");
		expect(gameLineCached("unseen")).toBeUndefined();
	});

	it("caps the cache, dropping everything past 200 lines", async () => {
		const provider = providerFor("x");
		for (let i = 0; i < 200; i++) {
			await translateGameLine(provider, `line ${i}`);
		}
		expect(gameLineCached("line 0")).toBe("x");
		await translateGameLine(provider, "line 200");
		expect(gameLineCached("line 0")).toBeUndefined();
		expect(gameLineCached("line 200")).toBe("x");
	});
});
