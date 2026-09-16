import { describe, it, expect } from "vitest";
import {
	markerPlacements,
	placeMarkers,
	type MarkerModel
} from "./editorImageMarkers";
import { FILE_MARKER, IMAGE_MARKER } from "./attachments";

function model(overrides: Partial<MarkerModel> & { id: string }): MarkerModel {
	return {
		kind: "image",
		name: "blue.png",
		tokens: 255,
		dataUrl: null,
		excerpt: "",
		busy: false,
		...overrides
	};
}

describe("markerPlacements", () => {
	it("finds nothing in plain prose", () => {
		expect(markerPlacements("hello world")).toEqual([]);
	});

	it("indexes each kind separately in document order", () => {
		const doc = `${IMAGE_MARKER} a ${FILE_MARKER} b ${IMAGE_MARKER}`;
		expect(markerPlacements(doc)).toEqual([
			{ from: 0, to: 14, label: IMAGE_MARKER, kind: "image", index: 0 },
			{ from: 17, to: 36, label: FILE_MARKER, kind: "text", index: 0 },
			{ from: 39, to: 53, label: IMAGE_MARKER, kind: "image", index: 1 }
		]);
	});

	it("covers stacked tags on one line", () => {
		const placements = markerPlacements(`${IMAGE_MARKER} ${IMAGE_MARKER} `);
		expect(placements.map((p) => p.index)).toEqual([0, 1]);
	});
});

describe("placeMarkers", () => {
	it("pairs the Nth tag of a kind with the Nth model", () => {
		const models = [
			model({ id: "a", kind: "image" }),
			model({ id: "b", kind: "image" }),
			model({ id: "c", kind: "text", name: "notes.md" })
		];
		const placed = placeMarkers(`${IMAGE_MARKER} x ${IMAGE_MARKER} y ${FILE_MARKER}`, models);
		expect(placed.map((p) => p.model?.id)).toEqual(["a", "b", "c"]);
	});

	it("leaves orphan tags model-less instead of mis-pairing", () => {
		const placed = placeMarkers(`${IMAGE_MARKER} ${IMAGE_MARKER}`, [model({ id: "a" })]);
		expect(placed.map((p) => p.model?.id ?? null)).toEqual(["a", null]);
	});

	it("ignores surplus models", () => {
		const placed = placeMarkers("plain", [model({ id: "a" })]);
		expect(placed).toEqual([]);
	});
});
