import { describe, expect, it } from "vitest";
import { cleanExternalAction, joinExternalDraft, routeExternalText } from "./externalText";

describe("joinExternalDraft", () => {
	it("fills an empty draft", () => {
		expect(joinExternalDraft("", "hello")).toBe("hello");
		expect(joinExternalDraft("   ", "hello")).toBe("hello");
	});

	it("blank-line separates from existing text", () => {
		expect(joinExternalDraft("question?", "今日は")).toBe("question?\n\n今日は");
	});

	it("trims trailing whitespace before joining", () => {
		expect(joinExternalDraft("question?  \n", "今日は")).toBe("question?\n\n今日は");
	});

	it("appends a multi-line share after an existing draft", () => {
		// ACTION_SEND shape (excerpt + URL) joins the draft the same
		// way a PROCESS_TEXT share does: one blank line, no gluing.
		expect(joinExternalDraft("what is this?", "Look at this\nhttps://example.com/menu")).toBe(
			"what is this?\n\nLook at this\nhttps://example.com/menu"
		);
	});
});

describe("cleanExternalAction", () => {
	it("keeps the tapped entry", () => {
		expect(cleanExternalAction("annotate")).toBe("annotate");
		expect(cleanExternalAction("speak")).toBe("speak");
		expect(cleanExternalAction("inspect")).toBe("inspect");
	});

	it("falls back to annotate", () => {
		expect(cleanExternalAction(null)).toBe("annotate");
		expect(cleanExternalAction(undefined)).toBe("annotate");
		expect(cleanExternalAction("delete")).toBe("annotate");
		expect(cleanExternalAction("")).toBe("annotate");
	});
});

describe("routeExternalText", () => {
	it("prefills foreign shares", () => {
		expect(routeExternalText("annotate", "from another app", "")).toBe("prefill");
		expect(routeExternalText("speak", "from another app", "other")).toBe("prefill");
	});

	it("runs the tapped action on matching text", () => {
		expect(routeExternalText("annotate", "same", "same")).toBe("annotate");
		expect(routeExternalText("speak", "same", "  same  ")).toBe("speak");
		expect(routeExternalText("inspect", "same", "same")).toBe("inspect");
	});

	it("runs the action when no text crosses (in-app tap)", () => {
		expect(routeExternalText("speak", null, "")).toBe("speak");
		expect(routeExternalText(null, null, "")).toBe("annotate");
	});
});
