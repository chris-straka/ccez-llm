import { describe, expect, it } from "vitest";
import {
	checkAgreement,
	expandLeaves,
	loadHandTable,
	normalizeVariant,
	parseRecord,
	repeatCount,
	resolveLevel,
	type DecompTable
} from "./cjkdecomp";

const SAMPLE = [
	"好:a(女,子)",
	"国:s(囗,玉)",
	"林:ra(木)",
	"森:r3tr(木)",
	"川:r3a(㇑)",
	"門:rrefr(𠁣)",
	"心:d/o(𠁼,㇃)",
	"漢:a(氵,37060)",
	"37060:d(廿,99970)",
	"99970:d/m(中,夫)",
	"木:wb(十,八)"
];

function sampleTable(): DecompTable {
	const t: DecompTable = new Map();
	for (const line of SAMPLE) {
		const rec = parseRecord(line);
		if (rec !== null) t.set(rec.char, rec);
	}
	return t;
}

describe("parseRecord", () => {
	it("parses char:type(part,part) lines", () => {
		expect(parseRecord("好:a(女,子)")).toEqual({
			char: "好",
			type: "a",
			parts: ["女", "子"]
		});
	});

	it("keeps type-code suffixes like d/o", () => {
		expect(parseRecord("心:d/o(𠁼,㇃)")?.type).toBe("d/o");
	});

	it("returns null for blank lines and throws without a colon", () => {
		expect(parseRecord("  ")).toBeNull();
		expect(() => parseRecord("nocolon")).toThrow();
	});
});

describe("repeatCount", () => {
	it("expands repeat codes by their documented arity", () => {
		expect(repeatCount("ra")).toBe(2);
		expect(repeatCount("r3tr")).toBe(3);
		expect(repeatCount("r3a")).toBe(3);
		expect(repeatCount("rrefr")).toBe(2);
	});

	it("keeps single children for reflect/modify codes, none for c", () => {
		expect(repeatCount("refh")).toBe(1);
		expect(repeatCount("msp")).toBe(1);
		expect(repeatCount("c")).toBe(0);
	});

	it("returns null for layout codes (children kept as-is)", () => {
		expect(repeatCount("a")).toBeNull();
		expect(repeatCount("d/o")).toBeNull();
		expect(repeatCount("str")).toBeNull();
	});
});

describe("resolveLevel", () => {
	it("resolves numeric intermediates but keeps real chars atomic", () => {
		const t = sampleTable();
		expect(resolveLevel(t, "漢")).toEqual(["氵", "廿", "中", "夫"]);
		expect(resolveLevel(t, "好")).toEqual(["女", "子"]);
	});

	it("expands repeat codes", () => {
		const t = sampleTable();
		expect(resolveLevel(t, "林")).toEqual(["木", "木"]);
		expect(resolveLevel(t, "森")).toEqual(["木", "木", "木"]);
		expect(resolveLevel(t, "門")).toEqual(["𠁣", "𠁣"]);
	});
});

describe("expandLeaves", () => {
	it("leaves unknown keys opaque", () => {
		expect(expandLeaves(sampleTable(), "子")).toEqual(["子"]);
	});
});

describe("normalizeVariant", () => {
	it("maps Mainland forms to the hand-table display forms", () => {
		expect(normalizeVariant("飠")).toBe("食");
		expect(normalizeVariant("卄")).toBe("艹");
		expect(normalizeVariant("㇑")).toBe("丨");
		expect(normalizeVariant("女")).toBe("女");
	});
});

describe("checkAgreement", () => {
	it("marks literal matches exact", () => {
		const t = sampleTable();
		expect(checkAgreement(t, "好", ["女", "子"]).verdict).toBe("exact");
		expect(checkAgreement(t, "国", ["囗", "玉"]).verdict).toBe("exact");
	});

	it("marks repeat-encoded matches resolved-agree", () => {
		const t = sampleTable();
		expect(checkAgreement(t, "林", ["木", "木"]).verdict).toBe(
			"resolved-agree"
		);
	});

	it("marks deeper splits mismatch", () => {
		const t = sampleTable();
		expect(checkAgreement(t, "漢", ["氵", "堇"]).verdict).toBe("mismatch");
	});
});

describe("loadHandTable", () => {
	it("parses the TABLE block from radicals.ts source", () => {
		const src = `const TABLE: Record<string, { c: string[]; n?: string }> = {\n\t好: { c: ["女", "子"] },\n\t森: { c: ["木", "木", "木"] },\n};`;
		const hand = loadHandTable(src);
		expect(hand.get("好")).toEqual(["女", "子"]);
		expect(hand.get("森")).toEqual(["木", "木", "木"]);
		expect(hand.size).toBe(2);
	});
});
