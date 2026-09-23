// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import {
	applyMarks,
	quoteTextNodes,
	repaintLiveWash,
	type AnnotationMark,
	type AnnotationId
} from "./annotations";
import {
	ANN_HIGHLIGHT_D1,
	ANN_HIGHLIGHT_D2,
	ANN_HIGHLIGHT_D3,
	ANN_HIGHLIGHT_NAME
} from "./annHighlights";

/** Minimal CSS.highlights stand-in: name -> Highlight holding ranges. */
class FakeHighlight {
	ranges: Range[];
	constructor(...ranges: Range[]) {
		this.ranges = ranges;
	}
	*[Symbol.iterator](): Iterator<Range> {
		yield* this.ranges;
	}
}

function installHighlightStubs(): Map<string, FakeHighlight> {
	const store = new Map<string, FakeHighlight>();
	vi.stubGlobal("Highlight", FakeHighlight);
	vi.stubGlobal("CSS", {
		highlights: {
			set: (name: string, hl: FakeHighlight) => store.set(name, hl),
			delete: (name: string) => store.delete(name),
			get: (name: string) => store.get(name)
		}
	});
	// The ramp path (not the snap path) is what must repaint on settle.
	vi.stubGlobal("matchMedia", () => ({ matches: false }));
	return store;
}

/** Count whole-root repaint nudges via the opacity toggle they start with. */
function countNudges(root: HTMLElement): { count: () => number } {
	let nudges = 0;
	const orig = root.style.setProperty.bind(root.style);
	root.style.setProperty = (prop: string, value: string, priority?: string) => {
		if (prop === "opacity") nudges += 1;
		return orig(prop, value, priority);
	};
	return { count: () => nudges };
}

describe("wash fade-in settle", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("forces a repaint after dropping the twin grades", () => {
		vi.useFakeTimers();
		const store = installHighlightStubs();
		const root = document.createElement("div");
		root.textContent = "say hello world today";
		const nudges = countNudges(root);
		const marks: AnnotationMark[] = [
			{ id: "a9" as AnnotationId, number: 1, quote: "hello world" }
		];

		applyMarks(root, marks, false, "a9");
		expect(nudges.count()).toBeGreaterThanOrEqual(1);

		// Walk the whole in-ramp (D3 -> D1 -> live, 35ms a step) to settle.
		vi.advanceTimersByTime(35);
		vi.advanceTimersByTime(35);
		vi.advanceTimersByTime(500);
		const settledNudges = nudges.count();

		// Settle must repaint after clearing the twins: the shell overlay
		// never repaints on registry deletes alone, so without this nudge
		// a stale twin sliver sticks above the wash until scroll/mouse.
		expect(settledNudges).toBeGreaterThanOrEqual(2);
		// Only the live name still holds ranges.
		expect(store.get(ANN_HIGHLIGHT_NAME)).toBeDefined();
		expect(store.get(ANN_HIGHLIGHT_D3)).toBeUndefined();
		expect(store.get(ANN_HIGHLIGHT_D1)).toBeUndefined();
	});
});

describe("live wash repair", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("repaints the live wash after tint-style node surgery", () => {
		const store = installHighlightStubs();
		const root = document.createElement("div");
		root.textContent = "昔新羅があり新羅が残る";
		document.body.appendChild(root);
		const marks: AnnotationMark[] = [
			{ id: "a1" as AnnotationId, number: 1, quote: "新羅", at: 1 }
		];
		applyMarks(root, marks, false, "a1");
		// First grade lands under a twin name on the ramp path; the
		// repair repaints the live name — read every grade.
		const painted = () =>
			[
				ANN_HIGHLIGHT_NAME,
				ANN_HIGHLIGHT_D1,
				ANN_HIGHLIGHT_D2,
				ANN_HIGHLIGHT_D3
			]
				.map((name) =>
					[...(store.get(name)?.ranges ?? [])]
						.map((r) => r.toString())
						.join("")
				)
				.join("");
		// Second occurrence, pre-surgery.
		expect(painted()).toBe("新羅");
		// Tint-style surgery: carve the second occurrence out of its
		// node and wrap it — replaceChild yanks the node the
		// registry points at, collapsing its endpoints.
		const nodes = quoteTextNodes(root);
		let host: Text | null = null;
		let idx = -1;
		let seen = 0;
		for (const n of nodes) {
			const t = n.textContent ?? "";
			let i = -1;
			while ((i = t.indexOf("新羅", i + 1)) >= 0) {
				seen += 1;
				if (seen === 2) {
					host = n;
					idx = i;
					break;
				}
			}
			if (host) break;
		}
		if (!host || idx < 0) throw new Error("no host node for surgery");
		host.splitText(idx + 2);
		const target = host.splitText(idx);
		const wrap = document.createElement("span");
		wrap.className = "frbt0";
		target.parentNode?.replaceChild(wrap, target);
		wrap.appendChild(target);
		// The registered range died with its node.
		expect(painted()).toBe("");
		repaintLiveWash();
		expect(painted()).toBe("新羅");
		root.remove();
	});
});
