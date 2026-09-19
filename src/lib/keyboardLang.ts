/**
 * macOS input-source id → voice locale (BCP-47) for the ⇧⌘Delete
 * "reset voice language to the keyboard" step. The Rust
 * `current_input_source` command returns the opaque bundle id of the
 * checked input-menu entry (e.g. `com.apple.keylayout.US`); this maps it
 * to a locale the voice picker and readback understand.
 *
 * Pure and unit-tested: match by substring so exact Apple ids (which vary
 * across releases) don't matter. SCIM/TCIM checked before bare Pinyin so
 * Simplified and Traditional stay apart. `null` means unrecognized — the
 * caller leaves the voice language unchanged.
 */
const KEYLAYOUT_LOCALES: Record<string, string> = {
	us: "en-US",
	abc: "en-US",
	british: "en-GB",
	canadiancsa: "fr-CA",
	french: "fr-FR",
	german: "de-DE",
	spanish: "es-ES",
	italian: "it-IT",
	portuguese: "pt-PT",
	brazilian: "pt-BR",
	russian: "ru-RU",
	japanese: "ja-JP",
	korean: "ko-KR"
};

export function voiceLocaleForInputSource(
	inputSourceId: string
): string | null {
	const id = inputSourceId.toLowerCase();
	if (id.includes("scim")) return "zh-CN";
	if (id.includes("tcim")) return "zh-TW";
	if (id.includes("zhuyin") || id.includes("cangjie")) return "zh-TW";
	if (id.includes("pinyin")) return "zh-CN";
	if (id.includes("kotoeri") || id.includes("japanese")) return "ja-JP";
	if (id.includes("korean")) return "ko-KR";
	const layout = id.split("keylayout.").pop() ?? id;
	const dotted = layout.split(".").pop() ?? layout;
	return KEYLAYOUT_LOCALES[dotted] ?? null;
}
