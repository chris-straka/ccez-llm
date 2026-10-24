import { expect, test, type Page } from "./fixtures";
import { seedChat } from "./helpers";

/**
 * Settings lists the downloaded dictionaries with their sizes (the
 * shell's `dict_list`, mocked here). Removing one deletes it and
 * keeps it from downloading again on its own; Download brings it
 * back.
 */
async function seedDictShell(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const packs: Record<string, number> = { fr: 20_176_915, de: 31_400_000 };
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
				if (cmd === "dict_remove") {
					delete packs[lang];
					return null;
				}
				if (cmd === "dict_install") {
					packs[lang] = 12_000_000;
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
	});
}

test("settings lists dictionaries with sizes, removes one and downloads it again", async ({
	page
}) => {
	await seedDictShell(page);
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({
		timeout: 60_000
	});
	await page.keyboard.press("ControlOrMeta+,");
	const panel = page.locator(".settings-panel");
	await expect(panel).not.toHaveClass(/closed/);
	const list = panel.getByRole("list", { name: "Dictionaries" });
	await expect(list.locator("li")).toHaveText([
		/French, 20 MB\s*Remove/,
		/German, 31 MB\s*Remove/
	]);
	await expect(panel.getByText("52 MB in all")).toBeVisible();
	await list.scrollIntoViewIfNeeded();
	await page.screenshot({ path: ".screenshots/dict-settings.png" });

	await panel.getByRole("button", { name: "Remove French dictionary" }).click();
	await expect(list.locator("li")).toHaveText([
		/French, removed\s*Download/,
		/German, 31 MB\s*Remove/
	]);
	await expect(panel.getByText("in all")).toHaveCount(0);
	// Settings save after a short debounce.
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

	await panel
		.getByRole("button", { name: "Download French dictionary" })
		.click();
	await expect(list.locator("li")).toHaveText([
		/French, 12 MB\s*Remove/,
		/German, 31 MB\s*Remove/
	]);
	const calls = await page.evaluate(
		() => (window as unknown as { __dictCalls: string[] }).__dictCalls
	);
	expect(calls).toContain("dict_remove fr");
	expect(calls).toContain("dict_install fr");
});
