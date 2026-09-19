// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
	applyMarks,
	type AnnotationMark,
	type AnnotationId
} from "./annotations";

/**
 * Two annotations in one message, the second overlapping the first's
 * badge position (the reported bug: the 2nd marker never appears).
 * The <em> forces the first badge mid-paragraph with text after it.
 */
function arabicBody(): HTMLElement {
	const root = document.createElement("div");
	root.innerHTML =
		"<p>تم استلام الاختبار، <em>وأنا متصل</em> وجاهز الآن. كيف يمكنني مساعدتك؟</p>";
	return root;
}

function badges(root: HTMLElement): string[] {
	return [...root.querySelectorAll("[data-ann-badge]")].map(
		(b) => b.textContent ?? ""
	);
}

describe("applyMarks with several annotations in one message", () => {
	it("stamps an adjacent later quote (no overlap)", () => {
		const root = arabicBody();
		const items: AnnotationMark[] = [
			{ id: "a1" as AnnotationId, number: 1, quote: "وأنا متصل" },
			{ id: "a2" as AnnotationId, number: 2, quote: "وجاهز الآن" }
		];
		applyMarks(root, items, false, "a2");
		expect(badges(root)).toEqual(["1", "2"]);
		expect(root.querySelectorAll("mark.ccez-ann").length).toBeGreaterThan(0);
	});

	it("stamps a quote overlapping the earlier badge position", () => {
		const root = arabicBody();
		const items: AnnotationMark[] = [
			{ id: "a1" as AnnotationId, number: 1, quote: "وأنا متصل" },
			{ id: "a2" as AnnotationId, number: 2, quote: "متصل وجاهز" }
		];
		applyMarks(root, items, false, "a2");
		expect(badges(root)).toEqual(["1", "2"]);
		expect(root.querySelectorAll("mark.ccez-ann").length).toBeGreaterThan(0);
	});

	it("stamps a nested quote containing the earlier one", () => {
		const root = arabicBody();
		const items: AnnotationMark[] = [
			{ id: "a1" as AnnotationId, number: 1, quote: "وأنا متصل" },
			{ id: "a2" as AnnotationId, number: 2, quote: "وأنا متصل وجاهز الآن" }
		];
		applyMarks(root, items, false, "a2");
		expect(badges(root)).toEqual(["1", "2"]);
		expect(root.querySelectorAll("mark.ccez-ann").length).toBeGreaterThan(0);
	});

	it("re-stamping never accumulates badges or washes", () => {
		const root = arabicBody();
		const items: AnnotationMark[] = [
			{ id: "a1" as AnnotationId, number: 1, quote: "وأنا متصل" },
			{ id: "a2" as AnnotationId, number: 2, quote: "متصل وجاهز" }
		];
		applyMarks(root, items, false, "a2");
		applyMarks(root, items, false, "a2");
		expect(badges(root)).toEqual(["1", "2"]);
	});
});
