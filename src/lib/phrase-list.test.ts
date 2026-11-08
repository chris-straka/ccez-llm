import { describe, expect, it } from "vitest";
import {
	cleanPhraseForm,
	isPhraseQuote,
	phraseFormMessages
} from "./phrase-list";

describe("isPhraseQuote", () => {
	it("takes short phrases, not single words or sentences", () => {
		expect(isPhraseQuote("s'est éloigné")).toBe(true);
		expect(isPhraseQuote("se rendre compte")).toBe(true);
		expect(isPhraseQuote("écarté")).toBe(false);
		expect(isPhraseQuote("Il s'est éloigné. Puis il est parti")).toBe(false);
		expect(isPhraseQuote("un deux trois quatre cinq six sept")).toBe(false);
	});
});

describe("cleanPhraseForm", () => {
	it("keeps the form alone", () => {
		expect(cleanPhraseForm("s'éloigner", "s'est éloigné")).toBe("s'éloigner");
		expect(cleanPhraseForm('"se rendre compte".\n', "s'en rend compte")).toBe(
			"se rendre compte"
		);
		expect(cleanPhraseForm("« s'éloigner »", "s'est éloigné")).toBe(
			"s'éloigner"
		);
	});
	it("falls back to the quote when the reply rambles", () => {
		expect(cleanPhraseForm("", "s'est éloigné")).toBe("s'est éloigné");
		expect(
			cleanPhraseForm(
				"The dictionary form here would be the reflexive verb s'éloigner meaning to move away",
				"s'est éloigné"
			)
		).toBe("s'est éloigné");
	});
});

describe("phraseFormMessages", () => {
	it("asks with the sentence and the phrase", () => {
		const [system, user] = phraseFormMessages(
			"s'est éloigné",
			"Le bateau s'est éloigné du port.",
			"French"
		);
		expect(system?.content).toContain("French");
		expect(user?.content).toContain("Le bateau s'est éloigné du port.");
		expect(user?.content).toContain("Phrase: s'est éloigné");
	});
});
