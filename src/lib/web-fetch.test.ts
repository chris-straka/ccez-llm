import { describe, expect, it } from "vitest";
import {
	articleId,
	batchexecuteBody,
	paramsPageUrl,
	parseBatchexecute,
	parseSignature,
	publicUrl
} from "./web-fetch";

describe("publicUrl", () => {
	it("takes public http(s) pages only", () => {
		expect(publicUrl("https://www.lemonde.fr/rss/une.xml")?.href).toBe(
			"https://www.lemonde.fr/rss/une.xml"
		);
		expect(publicUrl("https://93.184.215.14/")).not.toBeNull();
		for (const bad of [
			"file:///etc/passwd",
			"javascript:alert(1)",
			"https://user:pass@example.com/",
			"https://example.com/a b",
			"",
			"https://",
			"http://localhost:1420/",
			"http://app.localhost/",
			"http://127.0.0.1:11434/api/tags",
			"http://192.168.1.1/",
			"http://10.0.0.5/",
			"http://169.254.169.254/latest/",
			"http://100.101.102.103/",
			"http://[::1]/",
			"http://[::ffff:127.0.0.1]/",
			"http://0x7f.1/"
		]) {
			expect(publicUrl(bad), bad).toBeNull();
		}
	});
});

describe("Google News links", () => {
	it("reads the id from all three URL shapes", () => {
		expect(articleId("https://news.google.com/rss/articles/CBMabc?oc=5")).toBe(
			"CBMabc"
		);
		expect(articleId("https://news.google.com/articles/CBMabc")).toBe("CBMabc");
		expect(articleId("https://news.google.com/read/CBMabc?hl=en-US")).toBe(
			"CBMabc"
		);
		expect(articleId("https://example.com/rss/articles/CBMabc")).toBeNull();
		expect(articleId("https://news.google.com/rss/CBMabc")).toBeNull();
		expect(articleId("not a url")).toBeNull();
	});
	it("pins the params page and the batchexecute body to the shell's bytes", () => {
		expect(paramsPageUrl("CBMabc")).toBe(
			"https://news.google.com/rss/articles/CBMabc?hl=en-US&gl=US&ceid=US%3Aen"
		);
		expect(batchexecuteBody("ARTID", "1790714349", "SGVAL")).toBe(
			"f.req=%5B%5B%5B%22Fbv4je%22%2C%22%5B%5C%22garturlreq%5C%22%2C%5B%5B%5C%22X%5C%22%2C%5C%22X%5C%22%2C%5B%5C%22X%5C%22%2C%5C%22X%5C%22%5D%2Cnull%2Cnull%2C1%2C1%2C%5C%22US%3Aen%5C%22%2Cnull%2C1%2Cnull%2Cnull%2Cnull%2Cnull%2Cnull%2C0%2C1%5D%2C%5C%22X%5C%22%2C%5C%22X%5C%22%2C1%2C%5B1%2C1%2C1%5D%2C1%2C1%2Cnull%2C0%2C0%2Cnull%2C0%5D%2C%5C%22ARTID%5C%22%2C1790714349%2C%5C%22SGVAL%5C%22%5D%22%2Cnull%2C%220%22%5D%5D%5D"
		);
	});
	it("reads the signature and the publisher URL", () => {
		expect(parseSignature('<div data-n-a-sg="SIG" data-n-a-ts="123">')).toEqual(
			{ sig: "SIG", ts: "123" }
		);
		expect(parseSignature("<div>")).toBeNull();
		const inner = JSON.stringify([
			"garturlres",
			"https://www.lemonde.fr/article.html",
			1
		]);
		expect(
			parseBatchexecute(
				")]}'\n\n" +
					JSON.stringify([
						["wrb.fr", "Fbv4je", inner, null, null, null, "generic"],
						["di", 42]
					])
			)
		).toBe("https://www.lemonde.fr/article.html");
		expect(parseBatchexecute(")]}'\n\n[]")).toBeNull();
	});
});
