import { test, expect } from "@playwright/test";
import { seedChat, rowBoxes, expectBoxesStable } from "./helpers";

test.setTimeout(120_000);

test.describe("pinning", () => {
	/**
	 * Furigana end to end (lindera worker + vendored IPAdic): the only
	 * coverage of the real conversion engine — Vitest has no Web Worker.
	 * First run pays the dictionary download + build (tens of seconds);
	 * later runs reuse the worker cache per page load.
	 */
	test.beforeEach(async ({ page }) => {
		// Two soft-break lines, one paragraph: aid HTML must keep that
		// structure (one <p> with a <br>), or the message grows on pin.
		await seedChat(page, [
			{ role: "assistant", content: "漢字を読む\nテストです" }
		]);
		await page.goto("/");
		await expect(page.locator("article.assistant .actions")).toBeVisible({
			timeout: 60_000
		});
	});

	test("clicking the furigana aid pins kanji readings", async ({ page }) => {
		const aidBtn = page.locator(
			'article.assistant .actions button:has-text("読み仮名")'
		);
		const body = page.locator("article.assistant .rendered");
		const before = await body.boundingBox();
		if (!before) throw new Error("message body lost its box");
		await aidBtn.hover();
		await aidBtn.click();
		// Golden shape: one reading span each for 漢字 and 読, okurigana plain.
		await expect(body.locator(".frb")).toHaveCount(2, { timeout: 60_000 });
		await expect(body).toContainText("かんじ");
		await expect(body).toContainText("よ");
		// Readings are overlay, never layout: spawning them must not move
		// the base text by even a pixel.
		const after = await body.boundingBox();
		if (!after) throw new Error("message body lost its box");
		for (const key of ["x", "y", "width", "height"] as const) {
			expect(Math.abs(after[key] - before[key])).toBeLessThanOrEqual(1);
		}
	});

	/** Bold markdown survives the aid round-trip: pinning furigana must
	render <strong>, never literal asterisks (aids mode sets markdown
	aside, so inline bold has to be rescued like lists were). */
	test("pinning furigana keeps bold markdown bold", async ({ page }) => {
		await seedChat(page, [{ role: "assistant", content: "**漢字を読む**" }]);
		await page.goto("/");
		const body = page.locator("article.assistant .rendered");
		await expect(page.locator("article.assistant .actions")).toBeVisible({
			timeout: 60_000
		});
		// Unpinned (markdown path) renders bold, as the baseline.
		await expect(body.locator("strong")).toHaveCount(1);
		const aidBtn = page.locator(
			'article.assistant .actions button:has-text("読み仮名")'
		);
		await aidBtn.hover();
		await aidBtn.click();
		await expect(body.locator(".frb").first()).toBeVisible({ timeout: 60_000 });
		await expect(body.locator("strong")).toHaveCount(1);
		await expect(body).not.toContainText("**");
	});

	/** A message with its own Japanese and Chinese sections offers both
	local aids, furigana first. Kanji alone must not summon pinyin: only a
	Han-only line counts as Chinese. */
	test("a Japanese+Chinese message offers furigana and pinyin", async ({
		page
	}) => {
		await seedChat(page, [
			{ role: "assistant", content: "こんにちは！テストです。\n你好！测试。" }
		]);
		await page.goto("/");
		const actions = page.locator("article.assistant .actions");
		await expect(actions).toBeVisible({ timeout: 60_000 });
		await expect(actions.locator('button:has-text("読み仮名")')).toBeVisible();
		await expect(actions.locator('button:has-text("拼音")')).toBeVisible();
	});

	/** Pure Japanese (kana mixed through every line) stays furigana-only. */
	test("pure Japanese offers no pinyin button", async ({ page }) => {
		const actions = page.locator("article.assistant .actions");
		await expect(actions).toBeVisible({ timeout: 60_000 });
		await expect(actions.locator('button:has-text("読み仮名")')).toBeVisible();
		await expect(actions.locator('button:has-text("拼音")')).toHaveCount(0);
	});

	/** Japanese living only in code summons neither aid button. */
	test("code-only Japanese offers no aid buttons", async ({ page }) => {
		await seedChat(page, [
			{ role: "assistant", content: "```py\nprint('日本語')\n```" }
		]);
		await page.goto("/");
		const actions = page.locator("article.assistant .actions");
		await expect(actions).toBeVisible({ timeout: 60_000 });
		await expect(actions.locator('button:has-text("読み仮名")')).toHaveCount(0);
		await expect(actions.locator('button:has-text("拼音")')).toHaveCount(0);
	});

	/** Prose Japanese still offers furigana when code holds Japanese too. */
	test("prose Japanese offers furigana despite Japanese in code", async ({
		page
	}) => {
		await seedChat(page, [
			{ role: "assistant", content: "見る\n\n```py\nprint('日本語')\n```" }
		]);
		await page.goto("/");
		const actions = page.locator("article.assistant .actions");
		await expect(actions).toBeVisible({ timeout: 60_000 });
		await expect(actions.locator('button:has-text("読み仮名")')).toBeVisible();
	});

	/** Both aids pin at once on a mixed message: each renders only its own
	lines, and each button swaps in place to its own show-original — the
	row never shuffles, and unpinning one keeps the other up. */
	test("pinning furigana and pinyin together renders each on its own lines", async ({
		page
	}) => {
		await seedChat(page, [
			{ role: "assistant", content: "漢字を読む\n你好世界" }
		]);
		await page.goto("/");
		const actions = page.locator("article.assistant .actions");
		const body = page.locator("article.assistant .rendered");
		await expect(actions).toBeVisible({ timeout: 60_000 });
		await actions.locator('button:has-text("読み仮名")').click();
		await expect(body).toContainText("かんじ");
		await actions.locator('button:has-text("拼音")').click();
		await expect(body).toContainText("nǐ");
		// Both lines keep readings: furigana on the Japanese line, pinyin on
		// the Chinese line.
		await expect(body.locator(".frb")).not.toHaveCount(0);
		await expect(body).toContainText("かんじ");
		// Both buttons swapped in place to their own show-originals.
		await expect(
			actions.locator('button:has-text("オリジナルを表示")')
		).toBeVisible();
		await expect(actions.locator('button:has-text("显示原件")')).toBeVisible();
		// Unpinning furigana keeps pinyin up.
		await actions.locator('button:has-text("オリジナルを表示")').click();
		await expect(actions.locator('button:has-text("読み仮名")')).toBeVisible();
		await expect(actions.locator('button:has-text("显示原件")')).toBeVisible();
		await expect(body).toContainText("nǐ");
	});

	/** Clicking the pinyin aid pins Chinese readings (kana passes through). */
	test("clicking the pinyin aid pins Chinese readings", async ({ page }) => {
		await seedChat(page, [
			{ role: "assistant", content: "こんにちは！\n你好！" }
		]);
		await page.goto("/");
		const actions = page.locator("article.assistant .actions");
		const body = page.locator("article.assistant .rendered");
		await expect(actions).toBeVisible({ timeout: 60_000 });
		await actions.locator('button:has-text("拼音")').click();
		await expect(body.locator("ruby")).not.toHaveCount(0);
		await expect(body).toContainText("nǐ");
		await expect(actions.locator('button:has-text("显示原件")')).toBeVisible();
	});

	/** A Japanese pill owns kanji-only lines: furigana is offered on a
	kana-less sentence, and pinning it reads Japanese (not pinyin). */
	test("a Japanese pill gives kanji-only lines furigana", async ({ page }) => {
		await seedChat(
			page,
			[{ role: "assistant", content: "「警察官、交通規則違反者検挙中」" }],
			"ja"
		);
		await page.goto("/");
		const actions = page.locator("article.assistant .actions");
		const body = page.locator("article.assistant .rendered");
		await expect(actions).toBeVisible({ timeout: 60_000 });
		// Both aids stay offered (the line is genuinely ambiguous).
		await expect(actions.locator('button:has-text("読み仮名")')).toBeVisible();
		await expect(actions.locator('button:has-text("拼音")')).toBeVisible();
		await actions.locator('button:has-text("読み仮名")').click();
		await expect(body.locator(".frb").first()).toBeVisible({ timeout: 60_000 });
		await expect(body).toContainText("けいさつ");
	});

	/** Pinning furigana keeps code and math blocks: ruby stamps onto
	the rendered HTML, so fences stay fenced and equations stay KaTeX
	(never raw source text). */
	test("pinning furigana keeps code and math blocks", async ({ page }) => {
		await seedChat(page, [
			{
				role: "assistant",
				content: "漢字を読む\n\n```python\nprint('hi')\n```\n\n$$E = mc^2$$"
			}
		]);
		await page.goto("/");
		const actions = page.locator("article.assistant .actions");
		const body = page.locator("article.assistant .rendered");
		await expect(actions).toBeVisible({ timeout: 60_000 });
		await actions.locator('button:has-text("読み仮名")').click();
		await expect(body.locator(".frb").first()).toBeVisible({ timeout: 60_000 });
		await expect(body.locator(".ccez-code pre code")).toBeVisible();
		expect(await body.locator(".ccez-math .katex").count()).toBeGreaterThan(0);
		await expect(body.locator(".ccez-math-raw")).toBeHidden();
		await expect(body).not.toContainText("```python");
	});
});

test.describe("hover", () => {
	const ARTICLE = "article.assistant";

	// First run pays the dictionary build (tens of seconds), like furigana.e2e.ts.
	test.beforeEach(async ({ page }) => {
		await seedChat(page, [{ role: "assistant", content: "漢字を読むテスト" }]);
		await page.goto("/");
		await expect(page.locator(`${ARTICLE} .actions`)).toBeVisible({
			timeout: 60_000
		});
	});

	test("hovering furigana fetches nothing; clicking fetches with dots", async ({
		page
	}) => {
		const body = page.locator(`${ARTICLE} .rendered`);
		const furiganaBtn = page.locator(
			`${ARTICLE} .actions button[data-tip="Add furigana"]`
		);
		// Dots mount only while busy: an idle aid button is exactly its
		// visible label, so hover and spacing never cover text that isn't
		// there. (The :not(.off) keeps matching — no button carries .off.)
		const dots = page.locator(`${ARTICLE} .actions .tdots:not(.off)`);
		const before = await rowBoxes(page, ARTICLE);
		const beforeHtml = await body.innerHTML();

		// Hover must not start the dictionary load: no lit dots, no readings,
		// the Japanese untouched, no button nudged.
		await furiganaBtn.hover();
		await page.waitForTimeout(1500);
		await expect(dots).toHaveCount(0);
		expect(await body.innerHTML()).toBe(beforeHtml);
		expect(await body.locator(".frb").count()).toBe(0);
		expectBoxesStable(before, await rowBoxes(page, ARTICLE));

		// Click pins (and fetches): dots while loading, then the pinned
		// button. Conversion itself is unit-tested; e2e stays fast.
		await furiganaBtn.click();
		await expect(dots).toBeVisible({ timeout: 30_000 });
		await expect(
			page.locator(`${ARTICLE} .actions button[data-tip="オリジナルを表示"]`)
		).toBeVisible({ timeout: 60_000 });
	});
});

test.describe("ruby-geometry", () => {
	/**
	 * Ruby geometry: readings must sit over their own base characters.
	 * Two regressions lived here: a multi-kanji furigana base fragmented
	 * across a line break (its reading centered against the broken box
	 * and drifted right of the kanji), and per-character pinyin
	 * syllables longer than one Hanzi colliding into an unreadable row.
	 */
	test("a wrapped multi-kanji base keeps its reading centered", async ({
		page
	}) => {
		await page.setViewportSize({ width: 480, height: 800 });
		// One 12-kanji run: at this width it must wrap mid-run.
		await seedChat(page, [
			{ role: "assistant", content: "国際連合教育科学文化機関の活動について" }
		]);
		await page.goto("/");
		const actions = page.locator("article.assistant .actions");
		const body = page.locator("article.assistant .rendered");
		await expect(actions).toBeVisible({ timeout: 60_000 });
		await actions.locator('button:has-text("読み仮名")').click();
		await expect(body.locator(".frb").first()).toBeVisible({ timeout: 60_000 });
		// macOS pulls readings further left (Hiragana bearings put the
		// ink right of the kanji at the default offset), so box centers
		// no longer coincide there — ink does. Measure paint truth via
		// Range rects on mac, boxes elsewhere.
		const dataMac = await page.locator(".app").getAttribute("data-mac");
		const drift = await body.evaluate((el, mac) => {
			const rect = (node: Node): { l: number; w: number } => {
				if (!mac) {
					const r = (node as Element).getBoundingClientRect();
					return { l: r.left, w: r.width };
				}
				const rg = document.createRange();
				rg.selectNodeContents(node);
				const r = rg.getBoundingClientRect();
				return { l: r.left, w: r.width };
			};
			let worst = 0;
			for (const base of el.querySelectorAll(".frb")) {
				const reading = base.querySelector(".frt");
				if (!reading?.firstChild || !base.firstChild) continue;
				const b = rect(mac ? base.firstChild : base);
				const r = rect(mac ? reading.firstChild : reading);
				worst = Math.max(worst, Math.abs(b.l + b.w / 2 - (r.l + r.w / 2)));
			}
			return worst;
		}, dataMac !== null);
		expect(drift).toBeLessThan(dataMac !== null ? 2 : 4);
	});

	test("long pinyin syllables never collide with their neighbors", async ({
		page
	}) => {
		await seedChat(page, [{ role: "assistant", content: "双方创造价值" }]);
		await page.goto("/");
		const actions = page.locator("article.assistant .actions");
		const body = page.locator("article.assistant .rendered");
		await expect(actions).toBeVisible({ timeout: 60_000 });
		await actions.locator('button:has-text("拼音")').click();
		await expect(body.locator("ruby").first()).toBeVisible({ timeout: 60_000 });
		// Paint truth, not layout boxes: Range ink rects decide collisions.
		const overlaps = await body.evaluate((el) => {
			const boxes = [...el.querySelectorAll("rt")]
				.map((r) => {
					const rg = document.createRange();
					rg.selectNodeContents(r);
					return rg.getBoundingClientRect();
				})
				.filter((b) => b.width > 0 && b.height > 0);
			let hits = 0;
			for (let i = 0; i < boxes.length; i++) {
				for (let j = i + 1; j < boxes.length; j++) {
					const a = boxes[i] as DOMRect;
					const b = boxes[j] as DOMRect;
					const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
					const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
					if (x > 1 && y > 1) hits++;
				}
			}
			return { hits, count: boxes.length };
		});
		expect(overlaps.count).toBeGreaterThan(3);
		expect(overlaps.hits).toBe(0);
	});

	test("furigana stays off Chinese lines", async ({ page }) => {
		await seedChat(page, [{ role: "assistant", content: "漢字を読む\n银行" }]);
		await page.goto("/");
		const actions = page.locator("article.assistant .actions");
		const body = page.locator("article.assistant .rendered");
		await expect(actions).toBeVisible({ timeout: 60_000 });
		await actions.locator('button:has-text("読み仮名")').click();
		await expect(body.locator(".frb").first()).toBeVisible({ timeout: 60_000 });
		// Only the Japanese line converts (漢字 one run, 読 one).
		await expect(body.locator(".frb")).toHaveCount(2);
		await expect(body.locator('.frb:has-text("银")')).toHaveCount(0);
		await expect(body).toContainText("银行");
	});

	test("pinyin stays off Japanese lines", async ({ page }) => {
		await seedChat(page, [{ role: "assistant", content: "漢字を読む\n银行" }]);
		await page.goto("/");
		const actions = page.locator("article.assistant .actions");
		const body = page.locator("article.assistant .rendered");
		await expect(actions).toBeVisible({ timeout: 60_000 });
		await actions.locator('button:has-text("拼音")').click();
		await expect(body.locator("ruby").first()).toBeVisible({ timeout: 60_000 });
		// Only the Han-only line converts (银, 行).
		await expect(body.locator("ruby")).toHaveCount(2);
		await expect(body.locator('ruby:has-text("漢")')).toHaveCount(0);
		await expect(body).toContainText("漢字を読む");
	});

	test("pinning an aid keeps Arabic direction", async ({ page }) => {
		await seedChat(page, [
			{ role: "assistant", content: "مرحبا بالعالم\n你好世界" }
		]);
		await page.goto("/");
		const actions = page.locator("article.assistant .actions");
		const body = page.locator("article.assistant .rendered");
		await expect(actions).toBeVisible({ timeout: 60_000 });
		await actions.locator('button:has-text("拼音")').click();
		await expect(body.locator("ruby").first()).toBeVisible({ timeout: 60_000 });
		const dir = await body.evaluate((el) => {
			const ps = [...el.querySelectorAll("p")];
			const arabic = ps.find((p) => p.textContent?.includes("مرحبا"));
			if (!arabic) throw new Error("no Arabic paragraph");
			return {
				attr: arabic.getAttribute("dir"),
				css: getComputedStyle(arabic).direction
			};
		});
		expect(dir.attr).toBe("auto");
		expect(dir.css).toBe("rtl");
	});

	test("pinyin spreads only readings that overflow their Hanzi", async ({
		page
	}) => {
		await seedChat(page, [{ role: "assistant", content: "双方创造价值" }]);
		await page.goto("/");
		const actions = page.locator("article.assistant .actions");
		const body = page.locator("article.assistant .rendered");
		await expect(actions).toBeVisible({ timeout: 60_000 });
		// Natural Hanzi advance from the plain line's text node (6 uniform
		// Hanzi; the <p> itself is a full-width block, so its box lies).
		const plain = await body.evaluate((el) => {
			const p = el.querySelector("p");
			if (!p?.firstChild) throw new Error("no paragraph text");
			const rg = document.createRange();
			rg.selectNodeContents(p.firstChild);
			return rg.getBoundingClientRect().width / 6;
		});
		await actions.locator('button:has-text("拼音")').click();
		await expect(body.locator("ruby").first()).toBeVisible({ timeout: 60_000 });
		const widths = await body.evaluate((el) =>
			[...el.querySelectorAll("ruby")].map(
				(b) => b.getBoundingClientRect().width
			)
		);
		expect(widths.length).toBe(6);
		const min = Math.min(...widths);
		const max = Math.max(...widths);
		// Fitting readings cost ~nothing; overflowing ones spread.
		expect(Math.abs(min - plain)).toBeLessThan(1.5);
		expect(max - min).toBeGreaterThan(3);
	});
});

test.describe("keyboard", () => {
	/** The a key was once nested inside the modifier branch (dead —
	 * bare a never fired). Hovering Chinese + a must pin pinyin. */
	test("hovering Chinese and pressing a pins pinyin", async ({ page }) => {
		await seedChat(page, [{ role: "assistant", content: "你好世界" }]);
		await page.goto("/");
		const article = page.locator("article.assistant");
		const body = article.locator(".rendered");
		const actions = article.locator(".actions");
		await expect(actions).toBeVisible({ timeout: 60_000 });
		await article.hover();
		await page.evaluate(() =>
			(document.activeElement as HTMLElement | null)?.blur?.()
		);
		await page.keyboard.press("a");
		await expect(body.locator("ruby")).not.toHaveCount(0, { timeout: 10_000 });
		await expect(body).toContainText("nǐ");
		await expect(actions.locator('button:has-text("显示原件")')).toBeVisible();
		// Second press lifts it again.
		await page.keyboard.press("a");
		await expect(body.locator("ruby")).toHaveCount(0, { timeout: 10_000 });
	});

	/** Hovering Japanese + a pins furigana (same dead-branch regression). */
	test("hovering Japanese and pressing a pins furigana", async ({ page }) => {
		await seedChat(page, [{ role: "assistant", content: "漢字を読む" }]);
		await page.goto("/");
		const article = page.locator("article.assistant");
		const body = article.locator(".rendered");
		await expect(article.locator(".actions")).toBeVisible({ timeout: 60_000 });
		await article.hover();
		await page.evaluate(() =>
			(document.activeElement as HTMLElement | null)?.blur?.()
		);
		await page.keyboard.press("a");
		await expect(body.locator(".frb")).toHaveCount(2, { timeout: 60_000 });
		await expect(body).toContainText("かんじ");
	});

	/** M pins pinyin on the message in the middle of the screen. */
	test("m pins pinyin on the screen-center message", async ({ page }) => {
		const filler =
			"lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(20);
		await seedChat(page, [
			{ role: "user", content: `hi ${filler}` },
			{ role: "assistant", content: `Hello there ${filler}` },
			{ role: "user", content: `question ${filler}` },
			{ role: "assistant", content: "你好世界" },
			{ role: "user", content: `more ${filler}` },
			{ role: "assistant", content: `bye ${filler}` }
		]);
		await page.goto("/");
		await expect(
			page.locator("article.assistant .actions").first()
		).toBeVisible({ timeout: 60_000 });
		await page.waitForFunction(
			() => {
				const box = document.querySelector(".messages") as HTMLElement | null;
				return box !== null && box.scrollHeight > box.clientHeight + 500;
			},
			undefined,
			{ timeout: 15_000 }
		);
		await page.evaluate(() =>
			document.getElementById("msg-3")?.scrollIntoView({ block: "center" })
		);
		await page.waitForFunction(
			() => {
				const box = document
					.querySelector(".messages")
					?.getBoundingClientRect();
				const el = document.getElementById("msg-3")?.getBoundingClientRect();
				if (!box || !el) return false;
				const mid = box.top + box.height / 2;
				return el.top <= mid && el.bottom > mid;
			},
			undefined,
			{ timeout: 10_000 }
		);
		await page.evaluate(() =>
			(document.activeElement as HTMLElement | null)?.blur?.()
		);
		await page.keyboard.press("m");
		const center = page.locator("#msg-3");
		await expect(center.locator(".rendered").locator("ruby")).not.toHaveCount(
			0,
			{ timeout: 10_000 }
		);
		await expect(center.locator(".rendered")).toContainText("nǐ");
		// Nobody else gained readings.
		await expect(page.locator("#msg-1 .rendered ruby")).toHaveCount(0);
		await expect(page.locator("#msg-5 .rendered ruby")).toHaveCount(0);
	});

	/** N pins furigana on the message in the middle of the screen. */
	test("n pins furigana on the screen-center message", async ({ page }) => {
		const filler =
			"lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(20);
		await seedChat(page, [
			{ role: "user", content: `hi ${filler}` },
			{ role: "assistant", content: `Hello there ${filler}` },
			{ role: "user", content: `question ${filler}` },
			{ role: "assistant", content: "漢字を読む" },
			{ role: "user", content: `more ${filler}` },
			{ role: "assistant", content: `bye ${filler}` }
		]);
		await page.goto("/");
		await expect(
			page.locator("article.assistant .actions").first()
		).toBeVisible({ timeout: 60_000 });
		await page.waitForFunction(
			() => {
				const box = document.querySelector(".messages") as HTMLElement | null;
				return box !== null && box.scrollHeight > box.clientHeight + 500;
			},
			undefined,
			{ timeout: 15_000 }
		);
		await page.evaluate(() =>
			document.getElementById("msg-3")?.scrollIntoView({ block: "center" })
		);
		await page.waitForFunction(
			() => {
				const box = document
					.querySelector(".messages")
					?.getBoundingClientRect();
				const el = document.getElementById("msg-3")?.getBoundingClientRect();
				if (!box || !el) return false;
				const mid = box.top + box.height / 2;
				return el.top <= mid && el.bottom > mid;
			},
			undefined,
			{ timeout: 10_000 }
		);
		await page.evaluate(() =>
			(document.activeElement as HTMLElement | null)?.blur?.()
		);
		await page.keyboard.press("n");
		await expect(page.locator("#msg-3 .rendered .frb")).toHaveCount(2, {
			timeout: 60_000
		});
		await expect(page.locator("#msg-1 .rendered .frb")).toHaveCount(0);
	});
});

test.describe("keyboard mixed", () => {
	/** Hovering a mixed message and pressing a pins every offered aid:
	pinyin over the Chinese lines, furigana over the Japanese ones. */
	test("hovering mixed text and pressing a pins both aids", async ({
		page
	}) => {
		await seedChat(page, [
			{ role: "assistant", content: "漢字を読む\n你好世界" }
		]);
		await page.goto("/");
		const article = page.locator("article.assistant");
		const body = article.locator(".rendered");
		await expect(article.locator(".actions")).toBeVisible({ timeout: 60_000 });
		await article.hover();
		await page.evaluate(() =>
			(document.activeElement as HTMLElement | null)?.blur?.()
		);
		await page.keyboard.press("a");
		await expect(body.locator("ruby")).not.toHaveCount(0, { timeout: 10_000 });
		await expect(body.locator(".frb").first()).toBeVisible({ timeout: 60_000 });
		await expect(body).toContainText("nǐ");
		// Second press lifts both again.
		await page.keyboard.press("a");
		await expect(body.locator("ruby")).toHaveCount(0, { timeout: 10_000 });
		await expect(body.locator(".frb")).toHaveCount(0, { timeout: 10_000 });
	});
});
