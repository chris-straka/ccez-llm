import { expect, test, type Page } from "./fixtures";
import { seedChat } from "./helpers";

/**
 * Drags that start in the margin beside a message (no text under the
 * press). A wrapped paragraph has no newlines between its lines, and
 * the engine seats a margin press's anchor at some earlier selectable
 * spot (often the paragraph before): the drag must start on the line
 * beside the press instead. WebKit is the shell's engine; Chromium
 * starts no selection from a margin press at all.
 */
const LONG =
	"premier mot puis encore beaucoup de mots qui remplissent la ligne et " +
	"continuent sur la suivante puis la suivante encore et encore avec " +
	"toujours plus de mots pour remplir une troisième ligne entière puis " +
	"une quatrième jusqu'à la toute dernière ligne qui finit ici même";

type Line = { top: number; bottom: number; left: number; right: number };

/** The wrapped paragraph's visual lines, top to bottom. */
async function wrappedLines(page: Page): Promise<Line[]> {
	await seedChat(page, [
		{ role: "assistant", content: `Le paragraphe avant.\n\n${LONG}` }
	]);
	await page.goto("/");
	const body = page.locator("article.assistant .rendered").first();
	await expect(body).toBeVisible({ timeout: 60_000 });
	const lines = await body
		.locator("p")
		.nth(1)
		.evaluate((p) => {
			const range = document.createRange();
			range.selectNodeContents(p);
			const out: Line[] = [];
			for (const r of range.getClientRects()) {
				const last = out[out.length - 1];
				if (last && Math.abs(last.top - r.top) < 2)
					last.right = Math.max(last.right, r.right);
				else
					out.push({
						top: r.top,
						bottom: r.bottom,
						left: r.left,
						right: r.right
					});
			}
			return out;
		});
	expect(lines.length).toBeGreaterThanOrEqual(3);
	return lines;
}

const mid = (l: Line) => (l.top + l.bottom) / 2;
const selected = (page: Page) =>
	page.evaluate(() => window.getSelection()?.toString() ?? "");

test("a margin drag across a wrapped paragraph's last line highlights that line alone", async ({
	page
}) => {
	const lines = await wrappedLines(page);
	const last = lines[lines.length - 1]!;
	await page.mouse.move(6, mid(last));
	await page.mouse.down();
	await page.mouse.move(last.right - 2, mid(last), { steps: 10 });
	await page.mouse.up();
	const text = await selected(page);
	expect(text).toContain("ici même");
	expect(text).not.toContain("avant");
	expect(text).not.toContain("premier");
	expect(text).not.toContain("continuent");
});

test("a margin drag down from a middle line starts on that line", async ({
	page
}) => {
	const lines = await wrappedLines(page);
	const second = lines[1]!;
	const last = lines[lines.length - 1]!;
	await page.mouse.move(6, mid(second));
	await page.mouse.down();
	await page.mouse.move(last.right - 2, mid(last), { steps: 12 });
	await page.mouse.up();
	const text = await selected(page);
	expect(text).toContain("ici même");
	expect(text).not.toContain("avant");
	expect(text).not.toContain("premier");
});
