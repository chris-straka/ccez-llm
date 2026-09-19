// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { mockProviderEnabled } from "./mock";

/**
 * Mock mode is a browser preview/spec affordance: the flag must never
 * engage inside the Tauri shell, where a stray persisted entry would
 * stick the real app (phone or desktop) on canned "Mock reply to:"
 * responses under a "Mock provider active" note.
 */
describe("mockProviderEnabled", () => {
	afterEach(() => {
		window.localStorage.clear();
		delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
		delete (window as unknown as Record<string, unknown>).__TAURI__;
	});

	test("flag on in a plain browser enables mock", () => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		expect(mockProviderEnabled()).toBe(true);
	});

	test("flag on inside the Tauri shell stays off", () => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
		expect(mockProviderEnabled()).toBe(false);
	});

	test("no flag stays off", () => {
		expect(mockProviderEnabled()).toBe(false);
	});
});
