import { describe, expect, it } from "vitest";
import {
	BROWSER_HOME_URL,
	CHAT_MIN_PX,
	PANE_MIN_PX,
	afterClose,
	moveTab,
	newTab,
	paneWidth,
	readKept,
	resolveBrowserUrl,
	shareFor,
	shownUrl,
	stepTab,
	tabLabel
} from "./browser";

describe("the address bar", () => {
	it("opens a URL as typed, https added to a bare host, a search otherwise", () => {
		expect(resolveBrowserUrl("")).toBe(BROWSER_HOME_URL);
		expect(resolveBrowserUrl("example.com")).toBe("https://example.com/");
		expect(resolveBrowserUrl("lemonde.fr/international")).toBe(
			"https://lemonde.fr/international"
		);
		// This computer and the home network: plain http.
		expect(resolveBrowserUrl("localhost:3000")).toBe("http://localhost:3000/");
		expect(resolveBrowserUrl("192.168.1.1")).toBe("http://192.168.1.1/");
		expect(resolveBrowserUrl("[::1]:8080")).toBe("http://[::1]:8080/");
		expect(resolveBrowserUrl("nas.local/admin")).toBe("http://nas.local/admin");
		expect(resolveBrowserUrl("8.8.8.8")).toBe("https://8.8.8.8/");
		// Names in other scripts, and their punycode.
		expect(resolveBrowserUrl("münchen.de")).toBe("https://xn--mnchen-3ya.de/");
		expect(resolveBrowserUrl("пример.рф")).toMatch(/^https:\/\/xn--/);
		expect(resolveBrowserUrl("xn--e1afmkfd.xn--p1ai")).toBe(
			"https://xn--e1afmkfd.xn--p1ai/"
		);
		expect(resolveBrowserUrl("http://example.com")).toBe("http://example.com/");
		expect(resolveBrowserUrl("le monde")).toBe(
			"https://duckduckgo.com/?q=le%20monde"
		);
		expect(resolveBrowserUrl("passé composé")).toMatch(
			/^https:\/\/duckduckgo\.com\/\?q=/
		);
		// Never anything but the web.
		expect(resolveBrowserUrl("javascript:alert(1)")).toMatch(
			/^https:\/\/duckduckgo\.com\/\?q=/
		);
		expect(resolveBrowserUrl("file:///etc/passwd")).toMatch(
			/^https:\/\/duckduckgo\.com\/\?q=/
		);
	});

	it("searches in the chat's reply language where DuckDuckGo has its region", () => {
		expect(resolveBrowserUrl("pain au chocolat", "fr")).toBe(
			"https://duckduckgo.com/?q=pain%20au%20chocolat&kl=fr-fr"
		);
		expect(resolveBrowserUrl("ラーメン", "ja")).toMatch(/&kl=jp-jp$/);
		// No region for it, or no reply language: searched as usual.
		expect(resolveBrowserUrl("habari", "sw")).toBe(
			"https://duckduckgo.com/?q=habari"
		);
		expect(resolveBrowserUrl("hello", null)).toBe(
			"https://duckduckgo.com/?q=hello"
		);
		// An address is an address in any language.
		expect(resolveBrowserUrl("lemonde.fr", "fr")).toBe("https://lemonde.fr/");
	});

	it("shows the host, the rest after it, and Not secure for plain http", () => {
		expect(shownUrl("https://www.lemonde.fr/international/")).toEqual({
			host: "lemonde.fr",
			rest: "/international/",
			insecure: false
		});
		expect(shownUrl("http://example.com/?q=1").insecure).toBe(true);
		expect(
			shownUrl("https://fr.wikipedia.org/wiki/Christkindelsm%C3%A4rik").rest
		).toBe("/wiki/Christkindelsmärik");
		expect(shownUrl("https://example.com/100%").rest).toBe("/100%");
		expect(shownUrl("http://localhost:5173/").insecure).toBe(false);
	});
});

describe("the split", () => {
	it("keeps the chat and the pane to their minimums, expands when there's no room for both", () => {
		expect(paneWidth(0.5, 1200)).toEqual({ width: 600, expanded: false });
		expect(paneWidth(0.95, 1200).width).toBe(1200 - CHAT_MIN_PX);
		expect(paneWidth(0.05, 1200).width).toBe(PANE_MIN_PX);
		expect(paneWidth(0.5, CHAT_MIN_PX + PANE_MIN_PX - 1)).toEqual({
			width: CHAT_MIN_PX + PANE_MIN_PX - 1,
			expanded: true
		});
	});

	it("settles on a third, a half or two thirds when let go near one", () => {
		expect(shareFor(605, 1200)).toBe(0.5);
		expect(shareFor(400, 1200)).toBeCloseTo(1 / 3);
		expect(shareFor(700, 1200)).toBeCloseTo(700 / 1200);
	});
});

describe("tabs", () => {
	const tabs = ["a", "b", "c"].map((id) => newTab(id, "about:blank"));

	it("a close lands on the right neighbour, else the left", () => {
		expect(afterClose(tabs, "b")).toBe("c");
		expect(afterClose(tabs, "c")).toBe("b");
		expect(afterClose([tabs[0]!], "a")).toBeNull();
	});

	it("moves and steps with wrapping", () => {
		expect(moveTab(tabs, "a", 2).map((t) => t.id)).toEqual(["b", "c", "a"]);
		expect(stepTab(tabs, "c", 1)).toBe("a");
		expect(stepTab(tabs, "a", -1)).toBe("c");
	});

	it("are named by their title, else their host", () => {
		expect(tabLabel({ title: "  Le Monde ", url: "https://lemonde.fr/" })).toBe(
			"Le Monde"
		);
		expect(tabLabel({ title: "", url: "https://www.lemonde.fr/x" })).toBe(
			"lemonde.fr"
		);
		expect(tabLabel({ title: "", url: "about:blank" })).toBe("New tab");
	});
});

describe("what's kept", () => {
	it("reads back tabs, the active one and the split; drops anything that isn't a web page", () => {
		const kept = readKept(
			JSON.stringify({
				open: true,
				expanded: false,
				share: 0.4,
				active: "b",
				tabs: [
					{ id: "a", url: "https://lemonde.fr/", title: "Le Monde" },
					{ id: "b", url: "https://spiegel.de/", title: "" },
					{ id: "c", url: "file:///etc/passwd", title: "" },
					{ id: "../x", url: "https://x.com/", title: "" }
				]
			})
		);
		expect(kept.tabs.map((t) => t.id)).toEqual(["a", "b"]);
		expect(kept.active).toBe("b");
		expect(kept.share).toBe(0.4);
		expect(kept.open).toBe(true);
		expect(readKept("{bad").tabs).toEqual([]);
		// No tabs left: closed.
		expect(readKept(JSON.stringify({ open: true, tabs: [] })).open).toBe(false);
	});
	expect(PANE_MIN_PX).toBeGreaterThan(0);
});
