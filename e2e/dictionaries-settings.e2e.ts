import { expect, test, type Page } from "./fixtures";
import { seedChat } from "./helpers";

/**
 * Settings sums up the downloaded dictionaries and opens the manager:
 * every language pack as a tile, grouped like the language menus,
 * with its size on disk or its download size (the shell's `dict_list`
 * and `dict_catalog`, mocked here). Removing one keeps it from
 * downloading again on its own; downloading one brings it back.
 */
async function seedDictShell(
	page: Page,
	installed: Record<string, number>
): Promise<void> {
	await page.addInitScript((start: Record<string, number>) => {
		const packs = { ...start };
		const w = window as unknown as Record<string, unknown>;
		w.__dictCalls = [];
		w.__TAURI_INTERNALS__ = {
			invoke: async (
				cmd: string,
				args: Record<string, unknown>
			): Promise<unknown> => {
				const lang = String(args["lang"] ?? "");
				if (cmd.startsWith("dict_"))
					(w.__dictCalls as string[]).push(`${cmd} ${lang}`.trim());
				if (cmd === "dict_list")
					return Object.entries(packs).map(([l, bytes]) => ({
						lang: l,
						version: "2026.10.24",
						bytes
					}));
				if (cmd === "dict_catalog")
					return {
						fr: { bytes: 7_000_000, unpacked: 24_000_000, version: "1" },
						es: { bytes: 15_100_000, unpacked: 52_800_000, version: "1" },
						de: { bytes: 11_200_000, unpacked: 38_500_000, version: "1" }
					};
				if (cmd === "dict_remove") {
					delete packs[lang];
					return null;
				}
				if (cmd === "dict_install") {
					await new Promise((r) => setTimeout(r, 400));
					packs[lang] = 52_800_000;
					return "2026.10.24";
				}
				if (cmd === "dict_installed")
					return lang in packs ? "2026.10.24" : null;
				if (cmd === "keychain_get") return null;
				if (cmd === "keychain_set" || cmd === "keychain_delete") return null;
				if (cmd === "plugin:event|listen") return 1;
				throw new Error(`dict shell: unhandled ${cmd}`);
			},
			transformCallback: (): number => 0,
			unregisterCallback: (): void => {}
		};
	}, installed);
}

async function openSettings(page: Page): Promise<void> {
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({
		timeout: 60_000
	});
	await page.keyboard.press("ControlOrMeta+,");
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
}

test("settings sums up dictionaries; the manager filters, removes and downloads", async ({
	page
}) => {
	await seedDictShell(page, { fr: 20_176_915, de: 31_400_000 });
	await openSettings(page);
	const panel = page.locator(".settings-panel");
	await expect(panel.locator(".dict-sum")).toHaveText(
		"2 of 49 downloaded · 52 MB"
	);
	await panel.getByRole("button", { name: "Manage dictionaries" }).click();

	const sheet = page.getByRole("dialog", { name: "Dictionaries" });
	await expect(sheet).toBeVisible();
	await expect(sheet.locator(".dm-group h3")).toHaveText([
		/Europe\s*2 of/,
		/Asia\s*0 of/,
		/Africa\s*0 of/,
		/Classics\s*0 of/
	]);
	const tile = (name: string) =>
		sheet.locator(".dm-tile", { has: page.getByText(name, { exact: true }) });
	await expect(tile("French")).toHaveClass(/s-installed/);
	await expect(tile("French").locator(".dm-size")).toHaveText("20 MB");
	// On offer: the download size from the release's manifest.
	await expect(tile("Spanish")).toHaveClass(/s-available/);
	await expect(tile("Spanish").locator(".dm-size")).toHaveText("15 MB");

	// The filter narrows by name, endonym or code.
	await sheet.getByLabel("Filter languages").fill("deut");
	await expect(sheet.locator(".dm-tile")).toHaveCount(1);
	await expect(sheet.locator(".dm-name")).toHaveText("German");
	await sheet.getByLabel("Filter languages").fill("");

	await sheet.getByRole("button", { name: "Remove French dictionary" }).click();
	await expect(tile("French")).toHaveClass(/s-available/);
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(
						JSON.parse(
							localStorage.getItem("ccez-llm-settings-v1") ?? "{}"
						) as { dictionarySkip?: string[] }
					).dictionarySkip
			)
		)
		.toEqual(["fr"]);

	await sheet
		.getByRole("button", { name: "Download Spanish dictionary" })
		.click();
	await expect(tile("Spanish")).toHaveClass(/s-downloading/);
	await expect(tile("Spanish")).toHaveClass(/s-installed/);
	await expect(sheet.locator(".dm-sum")).toHaveText(
		"2 of 49 downloaded · 84 MB"
	);

	// Esc closes the manager; Settings stays open under it.
	await page.keyboard.press("Escape");
	await expect(sheet).toHaveCount(0);
	await expect(panel).not.toHaveClass(/closed/);
	await expect(panel.locator(".dict-sum")).toHaveText(
		"2 of 49 downloaded · 84 MB"
	);
	const calls = await page.evaluate(
		() => (window as unknown as { __dictCalls: string[] }).__dictCalls
	);
	expect(calls).toContain("dict_remove fr");
	expect(calls).toContain("dict_install es");
});

test("removing every dictionary asks first", async ({ page }) => {
	await seedDictShell(page, { fr: 20_000_000, de: 31_000_000, ja: 38_000_000 });
	await openSettings(page);
	await page.getByRole("button", { name: "Manage dictionaries" }).click();
	const sheet = page.getByRole("dialog", { name: "Dictionaries" });
	await sheet.getByRole("button", { name: "Remove all…" }).click();
	await expect(sheet.getByText("Remove all 3 dictionaries?")).toBeVisible();
	await sheet.getByRole("button", { name: "Cancel" }).click();
	await expect(sheet.locator(".s-installed")).toHaveCount(3);
	await sheet.getByRole("button", { name: "Remove all…" }).click();
	await sheet.getByRole("button", { name: "Remove all", exact: true }).click();
	await expect(sheet.locator(".s-installed")).toHaveCount(0);
	await expect(sheet.locator(".dm-sum")).toHaveText("None downloaded yet");
});

for (const width of [1440, 412])
	test(`the manager holds many languages at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		const many = `fr de es pt it ru pl nl sv el fi tr ja zh ko vi hi ar he la`
			.split(" ")
			.map((l, i) => [l, (12 + ((i * 7) % 60)) * 1_000_000] as const);
		await seedDictShell(page, Object.fromEntries(many));
		await openSettings(page);
		await page.getByRole("button", { name: "Manage dictionaries" }).click();
		const sheet = page.getByRole("dialog", { name: "Dictionaries" });
		await expect(sheet.locator(".s-installed")).toHaveCount(20);
		// No tile spills past the sheet.
		const overflow = await sheet.evaluate(
			(el) => el.scrollWidth - el.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(0);
		await page.screenshot({ path: `.screenshots/dict-manager-${width}.png` });
	});
