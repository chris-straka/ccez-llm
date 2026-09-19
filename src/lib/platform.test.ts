import { describe, it, expect } from "vitest";
import {
	isAndroidUserAgent,
	isIOSUserAgent,
	canWindowDrag,
	isCoarsePointer,
	isIPadDesktopMode,
	isTouchTablet,
	isMacPlatform,
	isWindowsPlatform,
	modKeyLabel,
	altKeyLabel,
	shiftKeyLabel,
	edgeSwipeTarget,
	contentSwipeTarget,
	visibleProviderIds,
	pinchZoomStep,
	twoFingerSwipeDir,
	twoFingerSlideDir,
	isThreeFingerTap,
	nextTapCount,
	threeFingerSwipeDir
} from "./platform";

const ANDROID_UA =
	"Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const IPHONE_UA =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const MAC_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

describe("isAndroidUserAgent", () => {
	it("matches Android phones and tablets", () => {
		expect(isAndroidUserAgent(ANDROID_UA)).toBe(true);
		expect(
			isAndroidUserAgent(
				"Mozilla/5.0 (Linux; Android 13; Pixel Tablet) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36"
			)
		).toBe(true);
	});
	it("rejects iOS and desktop agents", () => {
		expect(isAndroidUserAgent(IPHONE_UA)).toBe(false);
		expect(isAndroidUserAgent(MAC_UA)).toBe(false);
		expect(isAndroidUserAgent("")).toBe(false);
	});
});

describe("isIOSUserAgent", () => {
	it("matches iPhone and iPad agents", () => {
		expect(isIOSUserAgent(IPHONE_UA)).toBe(true);
		expect(
			isIOSUserAgent(
				"Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
			)
		).toBe(true);
	});
	it("rejects Android and desktop agents", () => {
		expect(isIOSUserAgent(ANDROID_UA)).toBe(false);
		expect(isIOSUserAgent(MAC_UA)).toBe(false);
		expect(isIOSUserAgent("")).toBe(false);
	});
});

describe("canWindowDrag", () => {
	it("refuses mobile shells whose drag would only reject into a toast", () => {
		expect(canWindowDrag(ANDROID_UA)).toBe(false);
		expect(canWindowDrag(IPHONE_UA)).toBe(false);
	});
	it("allows desktop agents (the backend gate still applies)", () => {
		expect(canWindowDrag(MAC_UA)).toBe(true);
	});
});

describe("isCoarsePointer", () => {
	it("passes the coarse query through", () => {
		const seen: string[] = [];
		const query = (media: string) => {
			seen.push(media);
			return { matches: true };
		};
		expect(isCoarsePointer(query)).toBe(true);
		expect(seen).toEqual(["(pointer: coarse)"]);
	});
	it("returns false when fine or when the query throws", () => {
		expect(isCoarsePointer(() => ({ matches: false }))).toBe(false);
		expect(
			isCoarsePointer(() => {
				throw new Error("no matchMedia");
			})
		).toBe(false);
	});
});

describe("isIPadDesktopMode", () => {
	const IPAD_DESKTOP_UA =
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
	it("spots desktop-mode iPads by touch points, not the UA token", () => {
		expect(isIPadDesktopMode(IPAD_DESKTOP_UA, 5)).toBe(true);
	});
	it("keeps real Macs and touch-less agents on desktop", () => {
		expect(isIPadDesktopMode(MAC_UA, 0)).toBe(false);
		expect(isIPadDesktopMode(IPAD_DESKTOP_UA, 1)).toBe(false);
		expect(isIPadDesktopMode(IPAD_DESKTOP_UA, 0)).toBe(false);
		expect(isIPadDesktopMode(ANDROID_UA, 5)).toBe(false);
		expect(isIPadDesktopMode("", 5)).toBe(false);
	});
});

describe("isTouchTablet", () => {
	const IPAD_DESKTOP_UA =
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
	it("sends desktop-mode iPads to the touch UI", () => {
		expect(
			isTouchTablet({
				ua: IPAD_DESKTOP_UA,
				coarse: true,
				maxTouchPoints: 5,
				smallestScreenDim: 820
			})
		).toBe(true);
	});
	it("sends other coarse touch tablets to the touch UI", () => {
		expect(
			isTouchTablet({
				ua: "Mozilla/5.0 (Linux; Android 13; Pixel Tablet) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
				coarse: true,
				maxTouchPoints: 10,
				smallestScreenDim: 800
			})
		).toBe(true);
	});
	it("keeps real Macs, touchscreen laptops, and phones out", () => {
		// Real Mac: Macintosh UA, no touch points.
		expect(
			isTouchTablet({
				ua: MAC_UA,
				coarse: false,
				maxTouchPoints: 0,
				smallestScreenDim: 900
			})
		).toBe(false);
		// Touchscreen laptop: fine primary pointer.
		expect(
			isTouchTablet({
				ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
				coarse: false,
				maxTouchPoints: 10,
				smallestScreenDim: 900
			})
		).toBe(false);
		// Phone-size touch device: below the tablet cutoff.
		expect(
			isTouchTablet({
				ua: ANDROID_UA,
				coarse: true,
				maxTouchPoints: 5,
				smallestScreenDim: 412
			})
		).toBe(false);
		// No touch hardware at all.
		expect(
			isTouchTablet({
				ua: MAC_UA,
				coarse: false,
				maxTouchPoints: 0,
				smallestScreenDim: 412
			})
		).toBe(false);
	});
	it("honors a custom size cutoff", () => {
		const probe = {
			ua: ANDROID_UA,
			coarse: true,
			maxTouchPoints: 5,
			smallestScreenDim: 500
		};
		expect(isTouchTablet(probe, 600)).toBe(false);
		expect(isTouchTablet(probe, 480)).toBe(true);
	});
});

describe("isMacPlatform", () => {
	it("reads the legacy platform string without hints", () => {
		expect(isMacPlatform("MacIntel")).toBe(true);
		expect(isMacPlatform("MacPPC")).toBe(true);
		expect(isMacPlatform("Win32")).toBe(false);
		expect(isMacPlatform("Linux x86_64")).toBe(false);
		expect(isMacPlatform("")).toBe(false);
	});
	it("lets Client Hints win over the legacy string", () => {
		expect(isMacPlatform("Win32", "macOS")).toBe(true);
		expect(isMacPlatform("MacIntel", "Windows")).toBe(false);
		expect(isMacPlatform("", "macOS")).toBe(true);
		expect(isMacPlatform("MacIntel", "  ")).toBe(true);
	});
});

describe("isWindowsPlatform", () => {
	it("reads the legacy platform string without hints", () => {
		expect(isWindowsPlatform("Win32")).toBe(true);
		expect(isWindowsPlatform("Win64")).toBe(true);
		expect(isWindowsPlatform("MacIntel")).toBe(false);
		expect(isWindowsPlatform("Linux x86_64")).toBe(false);
		expect(isWindowsPlatform("")).toBe(false);
	});
	it("lets Client Hints win over the legacy string", () => {
		expect(isWindowsPlatform("MacIntel", "Windows")).toBe(true);
		expect(isWindowsPlatform("Win32", "macOS")).toBe(false);
		expect(isWindowsPlatform("", "Windows")).toBe(true);
	});
	it("never claims both platforms at once", () => {
		for (const [platform, hint] of [
			["MacIntel", ""],
			["Win32", ""],
			["Linux x86_64", ""],
			["", "macOS"],
			["", "Windows"],
			["", ""]
		] as const) {
			expect(
				isMacPlatform(platform, hint) && isWindowsPlatform(platform, hint)
			).toBe(false);
		}
	});
});

describe("modifier labels", () => {
	it("shows glyphs on Mac, names elsewhere", () => {
		expect(modKeyLabel(true)).toBe("⌘");
		expect(altKeyLabel(true)).toBe("⌥");
		expect(shiftKeyLabel(true)).toBe("⇧");
		expect(modKeyLabel(false)).toBe("Ctrl");
		expect(altKeyLabel(false)).toBe("Alt");
		expect(shiftKeyLabel(false)).toBe("Shift");
	});
});

describe("edgeSwipeTarget", () => {
	const W = 412; // S24-class viewport width
	it("opens chats on a rightward swipe from the left edge", () => {
		expect(edgeSwipeTarget(4, 600, 120, 604, W)).toBe("chats");
	});
	it("opens settings on a leftward swipe from the right edge", () => {
		expect(edgeSwipeTarget(W - 4, 600, W - 120, 596, W)).toBe("settings");
	});
	it("rejects short drags, vertical scrolls, and mid-screen swipes", () => {
		expect(edgeSwipeTarget(4, 600, 30, 600, W)).toBeNull(); // too short
		expect(edgeSwipeTarget(4, 600, 120, 760, W)).toBeNull(); // vertical
		expect(edgeSwipeTarget(150, 600, 260, 604, W)).toBeNull(); // mid-screen
		expect(edgeSwipeTarget(4, 600, 3, 600, W)).toBeNull(); // wrong way
	});
	it("honors custom distance and zone", () => {
		expect(edgeSwipeTarget(30, 0, 100, 0, W, 48, 24)).toBeNull(); // outside zone
		expect(edgeSwipeTarget(30, 0, 100, 0, W, 48, 32)).toBe("chats");
	});
});

describe("contentSwipeTarget", () => {
	it("opens chats rightward and settings leftward from mid-screen", () => {
		expect(contentSwipeTarget(150, 600, 240, 604)).toBe("chats");
		expect(contentSwipeTarget(260, 600, 170, 596)).toBe("settings");
	});
	it("rejects short drags, vertical scrolls, and directionless taps", () => {
		expect(contentSwipeTarget(150, 600, 200, 600)).toBeNull(); // too short
		expect(contentSwipeTarget(150, 600, 260, 760)).toBeNull(); // vertical
		expect(contentSwipeTarget(150, 600, 151, 600)).toBeNull(); // tap
	});
});

describe("visibleProviderIds", () => {
	const CLOUD = ["muse", "deepseek"];
	it("lists everything on desktop, online or not", () => {
		expect(
			visibleProviderIds(CLOUD, { android: false, online: true, local: false })
		).toEqual(CLOUD);
		expect(
			visibleProviderIds(CLOUD, { android: false, online: false, local: false })
		).toEqual(CLOUD);
	});
	it("hides the local entry where its bridge can't exist", () => {
		const all = [...CLOUD, "local-gemma"];
		expect(
			visibleProviderIds(all, { android: false, online: true, local: true })
		).toEqual(CLOUD);
	});
	it("shows local alongside cloud on online Android once bridged", () => {
		const all = [...CLOUD, "local-gemma"];
		expect(
			visibleProviderIds(all, { android: true, online: true, local: true })
		).toEqual(all);
		expect(
			visibleProviderIds(all, { android: true, online: true, local: false })
		).toEqual(CLOUD);
	});
	it("keeps only local on offline Android", () => {
		const all = [...CLOUD, "local-gemma"];
		expect(
			visibleProviderIds(all, { android: true, online: false, local: true })
		).toEqual(["local-gemma"]);
		expect(
			visibleProviderIds(all, { android: true, online: false, local: false })
		).toEqual([]);
	});
});

describe("pinchZoomStep", () => {
	it("steps out on spread, in on pinch, holds inside the step", () => {
		expect(pinchZoomStep(200, 260)).toBe(1);
		expect(pinchZoomStep(200, 140)).toBe(-1);
		expect(pinchZoomStep(200, 230)).toBe(0);
		expect(pinchZoomStep(200, 180)).toBe(0);
	});
	it("fires exactly at the step boundary", () => {
		expect(pinchZoomStep(200, 248)).toBe(1);
		expect(pinchZoomStep(200, 152)).toBe(-1);
	});
});

describe("twoFingerSwipeDir", () => {
	const grip = (x: number, y: number) =>
		[
			{ id: 0, x, y },
			{ id: 1, x: x + 40, y }
		] as [
			{ id: number; x: number; y: number },
			{ id: number; x: number; y: number }
		];
	it("steps newer on swipe right, older on swipe left", () => {
		expect(twoFingerSwipeDir(grip(100, 600), grip(300, 600))).toBe(1);
		expect(twoFingerSwipeDir(grip(300, 600), grip(100, 600))).toBe(-1);
	});
	it("rejects short glides, splits, diagonals, and pinches", () => {
		expect(twoFingerSwipeDir(grip(100, 600), grip(140, 600))).toBeNull(); // too short
		const split = grip(100, 600);
		const splitEnd = grip(300, 600);
		splitEnd[1] = { ...splitEnd[1], x: 60 };
		expect(twoFingerSwipeDir(split, splitEnd)).toBeNull(); // fingers split
		expect(twoFingerSwipeDir(grip(100, 600), grip(300, 400))).toBeNull(); // diagonal
		const pinch = grip(100, 500);
		const pinched = grip(100, 300).map((f, i) => ({
			...f,
			x: i === 0 ? 40 : 200
		}));
		expect(twoFingerSwipeDir(pinch, pinched as typeof pinch)).toBeNull(); // opposite directions = pinch
		const spread = grip(100, 500);
		const spreadEnd: typeof spread = [
			{ id: 0, x: 220, y: 500 },
			{ id: 1, x: 340, y: 500 }
		];
		expect(twoFingerSwipeDir(spread, spreadEnd)).toBeNull(); // spread change = pinch
	});
});

describe("threeFingerSwipeDir", () => {
	it("steps newer on swipe right, older on swipe left", () => {
		expect(threeFingerSwipeDir(100, 600, 300, 600)).toBe(1);
		expect(threeFingerSwipeDir(300, 600, 100, 600)).toBe(-1);
	});
	it("rejects short glides, still taps, and steep diagonals", () => {
		expect(threeFingerSwipeDir(100, 600, 140, 600)).toBeNull(); // too short
		expect(threeFingerSwipeDir(200, 500, 205, 502)).toBeNull(); // tap jitter
		expect(threeFingerSwipeDir(100, 600, 300, 400)).toBeNull(); // diagonal
	});
});

describe("twoFingerSlideDir", () => {
	const grip = (x: number, y: number) =>
		[
			{ id: 0, x, y },
			{ id: 1, x: x + 40, y }
		] as [
			{ id: number; x: number; y: number },
			{ id: number; x: number; y: number }
		];
	it("slides up to the top, down to the bottom", () => {
		expect(twoFingerSlideDir(grip(200, 600), grip(200, 400))).toBe("top");
		expect(twoFingerSlideDir(grip(200, 400), grip(200, 600))).toBe("bottom");
	});
	it("rejects short slides, splits, diagonals, and pinches", () => {
		expect(twoFingerSlideDir(grip(200, 600), grip(200, 560))).toBeNull(); // too short
		const split = grip(200, 600);
		const splitEnd = grip(200, 400);
		splitEnd[1] = { ...splitEnd[1], y: 700 };
		expect(twoFingerSlideDir(split, splitEnd)).toBeNull(); // fingers split
		expect(twoFingerSlideDir(grip(200, 600), grip(400, 400))).toBeNull(); // diagonal
		expect(twoFingerSlideDir(grip(100, 600), grip(300, 600))).toBeNull(); // horizontal
		const spread = grip(200, 600);
		const spreadEnd: typeof spread = [
			{ id: 0, x: 160, y: 400 },
			{ id: 1, x: 380, y: 400 }
		];
		expect(twoFingerSlideDir(spread, spreadEnd)).toBeNull(); // spread change = pinch
	});
});

describe("isThreeFingerTap", () => {
	it("accepts a still three-finger tap, rejects everything else", () => {
		expect(isThreeFingerTap(3, 4, 180)).toBe(true);
		expect(isThreeFingerTap(2, 4, 180)).toBe(false);
		expect(isThreeFingerTap(3, 40, 180)).toBe(false);
		expect(isThreeFingerTap(3, 4, 900)).toBe(false);
	});
});

describe("nextTapCount", () => {
	it("starts a fresh run at one", () => {
		expect(nextTapCount(null, 1000, 50, 50)).toEqual({
			count: 1,
			at: 1000,
			x: 50,
			y: 50
		});
	});
	it("pairs nearby taps into double, triple, quadruple", () => {
		const one = nextTapCount(null, 1000, 50, 50);
		const two = nextTapCount(one, 1200, 52, 51);
		const three = nextTapCount(two, 1400, 51, 52);
		const four = nextTapCount(three, 1600, 50, 50);
		expect([two.count, three.count, four.count]).toEqual([2, 3, 4]);
	});
	it("cycles back to one after four", () => {
		const four = { count: 4, at: 1600, x: 50, y: 50 };
		expect(nextTapCount(four, 1800, 50, 50).count).toBe(1);
	});
	it("restarts on slow or distant taps", () => {
		const one = nextTapCount(null, 1000, 50, 50);
		expect(nextTapCount(one, 1500, 50, 50).count).toBe(1);
		expect(nextTapCount(one, 1200, 200, 200).count).toBe(1);
	});
});
