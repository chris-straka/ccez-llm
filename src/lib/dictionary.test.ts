import { describe, expect, it } from "vitest";
import { dictPack } from "./dictionary.svelte";
import { WORD_PROFILES } from "./word-card";

describe("dictPack", () => {
	it("has a pack for every language in the menus", () => {
		const missing = Object.keys(WORD_PROFILES).filter((l) => !dictPack(l));
		expect(missing).toEqual([]);
	});

	it("reads Literary Chinese and Biblical Hebrew from their modern packs", () => {
		expect(dictPack("lzh")).toBe("zh");
		expect(dictPack("hbo")).toBe("he");
		expect(dictPack("xx")).toBeNull();
	});
});
