import { describe, expect, it, vi } from "vitest";

import { readClipboardText } from "./clipboard";

describe("readClipboardText", () => {
	it("returns null when both readers fail", async () => {
		const shellRead = vi.fn().mockRejectedValue(new Error("denied"));
		const webRead = vi.fn().mockRejectedValue(new Error("denied"));
		await expect(
			readClipboardText(shellRead, webRead, true)
		).resolves.toBeNull();
	});

	it("falls back to the Web API when the shell read fails", async () => {
		const shellRead = vi.fn().mockRejectedValue(new Error("denied"));
		const webRead = vi.fn().mockResolvedValue("sk-ant-test");
		await expect(
			readClipboardText(shellRead, webRead, true)
		).resolves.toBe("sk-ant-test");
		expect(webRead).toHaveBeenCalledTimes(1);
	});

	it("prefers the shell read and skips the Web API on success", async () => {
		const shellRead = vi.fn().mockResolvedValue("sk-ant-shell");
		const webRead = vi.fn();
		await expect(
			readClipboardText(shellRead, webRead, true)
		).resolves.toBe("sk-ant-shell");
		expect(webRead).not.toHaveBeenCalled();
	});

	it("reads through the Web API alone outside the shell", async () => {
		const shellRead = vi.fn();
		const webRead = vi.fn().mockResolvedValue("sk-ant-web");
		await expect(
			readClipboardText(shellRead, webRead, false)
		).resolves.toBe("sk-ant-web");
		expect(shellRead).not.toHaveBeenCalled();
	});
});
