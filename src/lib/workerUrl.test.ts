import { describe, expect, it } from "vitest";
import { appRoot } from "./workerUrl";

describe("appRoot", () => {
	it("strips the production chunk path", () => {
		expect(
			appRoot(
				"https://app.example/_app/immutable/workers/furigana.worker-ABC.js"
			)
		).toBe("https://app.example");
	});
	it("keeps subpath deployments", () => {
		expect(appRoot("https://app.example/sub/_app/immutable/workers/f.js")).toBe(
			"https://app.example/sub"
		);
	});
	it("serves vite dev from the server root", () => {
		expect(appRoot("http://localhost:1420/src/lib/furigana.worker.ts")).toBe(
			"http://localhost:1420"
		);
		expect(appRoot("http://192.168.1.5:1420/src/lib/furigana.worker.ts")).toBe(
			"http://192.168.1.5:1420"
		);
	});
	it("handles the Tauri custom scheme", () => {
		expect(appRoot("tauri://localhost/_app/immutable/workers/f.js")).toBe(
			"tauri://localhost"
		);
	});
});
