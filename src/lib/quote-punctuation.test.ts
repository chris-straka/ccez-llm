// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { trimQuotePunctuation } from "./annotations-stamp";

describe("trimQuotePunctuation", () => {
	it("drops sentence punctuation a pick took in after the words", () => {
		expect(trimQuotePunctuation("sel.")).toBe("sel");
		expect(trimQuotePunctuation("lugubre,")).toBe("lugubre");
		expect(trimQuotePunctuation("déçu ?")).toBe("déçu");
		expect(trimQuotePunctuation("Je suis là !")).toBe("Je suis là");
		expect(trimQuotePunctuation("京都。")).toBe("京都");
		expect(trimQuotePunctuation("etc…")).toBe("etc");
	});
	it("keeps brackets, quote marks, and a pick of punctuation alone", () => {
		expect(trimQuotePunctuation("(sel)")).toBe("(sel)");
		expect(trimQuotePunctuation("« sel »")).toBe("« sel »");
		expect(trimQuotePunctuation("?!")).toBe("?!");
	});
});
