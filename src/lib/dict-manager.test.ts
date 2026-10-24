import { describe, expect, it } from "vitest";
import {
	DICT_LANGS,
	dictGroups,
	dictMatches,
	dictPack,
	dictSize,
	dictSummary,
	dictTile
} from "./dict-manager";

describe("dictGroups", () => {
	it("lists every pack once, grouped like the language menus", () => {
		const groups = dictGroups();
		expect(groups.map((g) => g.label)).toEqual([
			"Europe",
			"Asia",
			"Africa",
			"Classics"
		]);
		const langs = groups.flatMap((g) => g.langs.map((l) => l.lang));
		expect(new Set(langs).size).toBe(langs.length);
		expect(new Set(langs)).toEqual(new Set(DICT_LANGS));
	});

	it("names each pack, with its endonym when that differs", () => {
		const de = dictGroups()
			.flatMap((g) => g.langs)
			.find((l) => l.lang === "de");
		expect(de?.name).toBe("German");
		expect(de?.native).toBe("Deutsch");
	});

	it("files shared packs under their own language", () => {
		expect(dictPack("lzh")).toBe("zh");
		expect(dictPack("hbo")).toBe("he");
		expect(dictPack("xx")).toBeNull();
	});
});

describe("dictTile", () => {
	const fr = { lang: "fr", name: "French", native: "Français" };
	const catalog = {
		fr: { bytes: 7_030_716, unpacked: 24_038_403, version: "1" }
	};

	it("shows the size on disk once downloaded", () => {
		expect(
			dictTile(
				fr,
				[{ lang: "fr", version: "1", bytes: 24_038_403 }],
				{},
				catalog
			)
		).toMatchObject({ state: "installed", size: "24 MB" });
	});

	it("shows progress while downloading, over what's on disk", () => {
		expect(
			dictTile(
				fr,
				[{ lang: "fr", version: "1", bytes: 1 }],
				{ fr: 0.42 },
				catalog
			)
		).toMatchObject({ state: "downloading", size: "42%", progress: 0.42 });
	});

	it("shows the download size of a pack on offer, or nothing offline", () => {
		expect(dictTile(fr, [], {}, catalog)).toMatchObject({
			state: "available",
			size: "7.0 MB"
		});
		expect(dictTile(fr, [], {}, null).size).toBe("");
	});
});

describe("dictMatches", () => {
	const de = { lang: "de", name: "German", native: "Deutsch" };
	it("matches by name, endonym or code, any case", () => {
		expect(dictMatches(de, "ger")).toBe(true);
		expect(dictMatches(de, "DEUT")).toBe(true);
		expect(dictMatches(de, "de")).toBe(true);
		expect(dictMatches(de, "  ")).toBe(true);
		expect(dictMatches(de, "fren")).toBe(false);
	});
});

describe("dictSummary", () => {
	it("counts what's downloaded and its size", () => {
		expect(dictSummary([], 49)).toBe("None downloaded yet");
		expect(
			dictSummary(
				[
					{ lang: "fr", version: "1", bytes: 20_000_000 },
					{ lang: "de", version: "1", bytes: 31_500_000 }
				],
				49
			)
		).toBe("2 of 49 downloaded · 52 MB");
		expect(dictSize(840_000)).toBe("840 KB");
	});
});
