import { describe, expect, it } from "vitest";
import { defaultSettings } from "./settings";
import { settingsFileEdit, settingsForFile } from "./settings-file";

function live() {
	const s = defaultSettings();
	const [id] = Object.keys(s.providers);
	s.providers[id!]!.apiKey = "sk-live-secret";
	return { s, id: id! };
}

describe("settingsForFile", () => {
	it("never writes a key", () => {
		const { s } = live();
		expect(settingsForFile(s)).not.toContain("sk-live-secret");
	});
});

describe("settingsFileEdit", () => {
	it("is nothing when the file matches, whatever its key order", () => {
		const { s } = live();
		const file = JSON.parse(settingsForFile(s)) as Record<string, unknown>;
		const reordered = Object.fromEntries(Object.entries(file).reverse());
		expect(settingsFileEdit(JSON.stringify(reordered), s)).toBeNull();
	});

	it("returns only the changed fields, clamped like a stored copy", () => {
		const { s } = live();
		s.voiceVolume = 0.6;
		const file = JSON.parse(settingsForFile(s)) as Record<string, unknown>;
		expect(
			settingsFileEdit(JSON.stringify({ ...file, voiceVolume: 0.4 }), s)
		).toEqual({ voiceVolume: 0.4 });
		expect(
			settingsFileEdit(JSON.stringify({ ...file, voiceVolume: 9 }), s)
		).toEqual({ voiceVolume: 1 });
	});

	it("keeps live keys and launch-only state", () => {
		const { s, id } = live();
		const file = JSON.parse(settingsForFile(s)) as Record<string, unknown>;
		// The last run's voice and chat list are no edit.
		expect(
			settingsFileEdit(
				JSON.stringify({ ...file, voice: !s.voice, sidebarCollapsed: false }),
				s
			)
		).toBeNull();
		const providers = file.providers as Record<string, { model: string }>;
		const edit = settingsFileEdit(
			JSON.stringify({
				...file,
				providers: { ...providers, [id]: { ...providers[id], model: "x-1" } }
			}),
			s
		);
		expect(edit?.providers?.[id]).toMatchObject({
			model: "x-1",
			apiKey: "sk-live-secret"
		});
	});

	it("ignores what isn't settings", () => {
		const { s } = live();
		expect(settingsFileEdit("{half", s)).toBeNull();
		expect(settingsFileEdit("[]", s)).toBeNull();
	});
});
