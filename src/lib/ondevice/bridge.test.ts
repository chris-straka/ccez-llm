import { describe, it, expect, vi } from "vitest";
import {
	clampMaxTokens,
	downloadedMB,
	generateOnDevice,
	isOnDeviceProvider,
	ONDEVICE_PROVIDER_ID,
	onDeviceErrorCopy,
	onDeviceNotReadyCopy,
	onDeviceStatus,
	onDeviceUnsupported,
	openAICorePage,
	parseOnDeviceStatus,
	type OnDeviceDeps
} from "./bridge";

function depsWith(result: unknown): {
	deps: OnDeviceDeps;
	invoke: ReturnType<typeof vi.fn>;
} {
	const invoke = vi.fn(async () => result);
	return { deps: { shell: true, invoke }, invoke };
}

describe("on-device provider gate", () => {
	it("matches only the parked local entry", () => {
		expect(ONDEVICE_PROVIDER_ID).toBe("local-mlkit");
		expect(isOnDeviceProvider("local-mlkit")).toBe(true);
		expect(isOnDeviceProvider("muse")).toBe(false);
		expect(isOnDeviceProvider("deepseek")).toBe(false);
		expect(isOnDeviceProvider("mock")).toBe(false);
		expect(isOnDeviceProvider("")).toBe(false);
	});
});

describe("onDeviceErrorCopy", () => {
	const cases: Array<[unknown, string]> = [
		[
			"stale-aicore",
			"On-device chat isn't ready. Update AI Core in the Play Store or restart this phone, then try again."
		],
		[
			"no-model",
			"On-device model isn't downloaded yet. Reconnect to download it once, then it works offline."
		],
		[
			"downloading",
			"On-device model is still downloading. Try again in a bit."
		],
		["no-bridge", "On-device chat isn't available on this device."],
		["unsupported", "On-device chat isn't available on this device."],
		["busy", "On-device chat is busy. Try again in a moment."],
		[
			"too-long",
			"That message is too long for on-device chat. Shorten it and try again."
		],
		["cancelled", "On-device reply stopped."],
		["failed", "On-device chat failed. Try again."],
		["anything-else", "On-device chat failed. Try again."],
		["", "On-device chat failed. Try again."],
		[null, "On-device chat failed. Try again."],
		[undefined, "On-device chat failed. Try again."]
	];
	for (const [reason, copy] of cases) {
		it(`maps ${JSON.stringify(reason)} to one short sentence`, () => {
			const text = onDeviceErrorCopy(reason);
			expect(text).toBe(copy);
			expect(text.length).toBeLessThanOrEqual(140);
			expect(text).not.toContain("\n");
		});
	}
});

describe("onDeviceNotReadyCopy", () => {
	it("prefers the native reason when one is present", () => {
		expect(
			onDeviceNotReadyCopy({ state: "error", reason: "no-model" })
		).toBe(onDeviceErrorCopy("no-model"));
	});
	it("names a downloading state with no reason instead of failing vaguely", () => {
		expect(onDeviceNotReadyCopy({ state: "downloading" })).toBe(
			onDeviceErrorCopy("downloading")
		);
	});
	it("reads a bare unavailable state as unsupported, never failed", () => {
		const copy = onDeviceNotReadyCopy({ state: "unavailable" });
		expect(copy).toBe(onDeviceErrorCopy("unsupported"));
		expect(copy).not.toContain("Try again");
	});
});

describe("openAICorePage", () => {
	it("rejects outside the shell without invoking", async () => {
		const invoke = vi.fn(async () => {
			throw new Error("must not be called");
		});
		await expect(openAICorePage({ shell: false, invoke })).rejects.toThrow(
			"isn't available on this device"
		);
		expect(invoke).not.toHaveBeenCalled();
	});
	it("invokes the store command in the shell", async () => {
		const { deps, invoke } = depsWith(undefined);
		await openAICorePage(deps);
		expect(invoke).toHaveBeenCalledWith("ondevice_open_aicore_page");
	});
});

describe("clampMaxTokens", () => {
	it("holds the bridge range with a sane default", () => {
		expect(clampMaxTokens(undefined)).toBe(512);
		expect(clampMaxTokens(Number.NaN)).toBe(512);
		expect(clampMaxTokens(0)).toBe(1);
		expect(clampMaxTokens(-40)).toBe(1);
		expect(clampMaxTokens(200)).toBe(200);
		expect(clampMaxTokens(100000)).toBe(4096);
		expect(clampMaxTokens(256.9)).toBe(256);
	});
});

describe("parseOnDeviceStatus", () => {
	it("passes states through and clamps progress", () => {
		expect(parseOnDeviceStatus("ready")).toEqual({ state: "ready" });
		expect(
			parseOnDeviceStatus({ state: "downloading", progress: 0.5 })
		).toEqual({
			state: "downloading",
			progress: 0.5
		});
		expect(parseOnDeviceStatus({ state: "downloading", progress: 9 })).toEqual({
			state: "downloading",
			progress: 1
		});
		expect(parseOnDeviceStatus({ state: "error", reason: "busy" })).toEqual({
			state: "error",
			reason: "busy"
		});
	});

	it("carries the probe walk's winning variant", () => {
		expect(
			parseOnDeviceStatus({ state: "ready", variant: "full-stable" })
		).toEqual({ state: "ready", variant: "full-stable" });
		expect(parseOnDeviceStatus({ state: "ready", variant: 7 })).toEqual({
			state: "ready"
		});
	});

	it("carries the native detail one-liner, capped", () => {
		expect(
			parseOnDeviceStatus({
				state: "error",
				reason: "failed",
				detail: "java.lang.Exception: timed out"
			})
		).toEqual({
			state: "error",
			reason: "failed",
			detail: "java.lang.Exception: timed out"
		});
		expect(
			parseOnDeviceStatus({
				state: "error",
				reason: "failed",
				detail: "  "
			})
		).toEqual({ state: "error", reason: "failed" });
		const long = parseOnDeviceStatus({
			state: "error",
			reason: "failed",
			detail: "x".repeat(500)
		});
		expect(long.detail).toHaveLength(200);
	});

	it("reads garbage as an error, never throws", () => {
		expect(parseOnDeviceStatus("bogus")).toEqual({
			state: "error",
			reason: "bad-status"
		});
		expect(parseOnDeviceStatus({})).toEqual({
			state: "error",
			reason: "bad-status"
		});
		expect(parseOnDeviceStatus(null)).toEqual({
			state: "error",
			reason: "bad-status"
		});
		expect(parseOnDeviceStatus(42)).toEqual({
			state: "error",
			reason: "bad-status"
		});
	});
});

describe("onDeviceStatus", () => {
	it("reads unavailable outside the shell without invoking", async () => {
		const invoke = vi.fn(async () => {
			throw new Error("must not be called");
		});
		expect(await onDeviceStatus({ shell: false, invoke })).toEqual({
			state: "unavailable",
			reason: "no-bridge"
		});
		expect(invoke).not.toHaveBeenCalled();
	});

	it("passes native payloads through the parser", async () => {
		const { deps } = depsWith({ state: "downloading", progress: 0.25 });
		expect(await onDeviceStatus(deps)).toEqual({
			state: "downloading",
			progress: 0.25
		});
	});

	it("reads a rejected bridge as unavailable", async () => {
		const invoke = vi.fn(async () => {
			throw new Error("no-bridge");
		});
		expect(await onDeviceStatus({ shell: true, invoke })).toEqual({
			state: "unavailable",
			reason: "no-bridge"
		});
	});
});

describe("generateOnDevice", () => {
	it("resolves native text and forwards prompt + clamped cap", async () => {
		const { deps, invoke } = depsWith("hello back");
		await expect(
			generateOnDevice("hello", { maxTokens: 64 }, deps)
		).resolves.toBe("hello back");
		expect(invoke).toHaveBeenCalledWith("ondevice_generate", {
			prompt: "hello",
			maxTokens: 64
		});
	});

	it("throws the short copy outside the shell without invoking", async () => {
		const invoke = vi.fn(async () => "must not be called");
		await expect(
			generateOnDevice("hi", undefined, { shell: false, invoke })
		).rejects.toThrow("On-device chat isn't available on this device.");
		expect(invoke).not.toHaveBeenCalled();
	});

	it("maps native rejections to the short copy", async () => {
		const invoke = vi.fn(async () => {
			throw new Error("busy");
		});
		await expect(
			generateOnDevice("hi", undefined, { shell: true, invoke })
		).rejects.toThrow("On-device chat is busy. Try again in a moment.");
	});

	it("rejects empty or non-text completions with the default copy", async () => {
		const { deps } = depsWith("");
		await expect(generateOnDevice("hi", undefined, deps)).rejects.toThrow(
			"On-device chat failed. Try again."
		);
		const other = depsWith(42);
		await expect(generateOnDevice("hi", undefined, other.deps)).rejects.toThrow(
			"On-device chat failed. Try again."
		);
	});
});

describe("parseOnDeviceStatus downloadedBytes", () => {
	it("keeps whole bytes while downloading, floors fractions", () => {
		expect(
			parseOnDeviceStatus({ state: "downloading", downloadedBytes: 50331648 })
		).toEqual({
			state: "downloading",
			downloadedBytes: 50331648
		});
		expect(
			parseOnDeviceStatus({ state: "downloading", downloadedBytes: 10.9 })
		).toEqual({
			state: "downloading",
			downloadedBytes: 10
		});
	});

	it("drops the count outside downloading and drops nonsense", () => {
		expect(parseOnDeviceStatus({ state: "ready", downloadedBytes: 7 })).toEqual(
			{
				state: "ready"
			}
		);
		expect(
			parseOnDeviceStatus({ state: "downloading", downloadedBytes: -1 })
		).toEqual({
			state: "downloading"
		});
		expect(
			parseOnDeviceStatus({ state: "downloading", downloadedBytes: Number.NaN })
		).toEqual({
			state: "downloading"
		});
		expect(
			parseOnDeviceStatus({ state: "downloading", downloadedBytes: "48 MB" })
		).toEqual({
			state: "downloading"
		});
	});
});

describe("onDeviceUnsupported", () => {
	it("hides the entry only on a positive unsupported verdict", () => {
		expect(
			onDeviceUnsupported({ state: "unavailable", reason: "unsupported" })
		).toBe(true);
		expect(
			onDeviceUnsupported({ state: "unavailable", reason: "no-model" })
		).toBe(false);
		expect(
			onDeviceUnsupported({ state: "unavailable", reason: "no-bridge" })
		).toBe(false);
		expect(onDeviceUnsupported({ state: "downloading" })).toBe(false);
		expect(onDeviceUnsupported({ state: "ready" })).toBe(false);
		expect(onDeviceUnsupported({ state: "error", reason: "unsupported" })).toBe(
			false
		);
	});
});

describe("downloadedMB", () => {
	it("renders whole megabytes, null for nonsense", () => {
		expect(downloadedMB(50331648)).toBe("48 MB");
		expect(downloadedMB(0)).toBe("0 MB");
		expect(downloadedMB(undefined)).toBe(null);
		expect(downloadedMB(-5)).toBe(null);
		expect(downloadedMB(Number.NaN)).toBe(null);
	});
});
