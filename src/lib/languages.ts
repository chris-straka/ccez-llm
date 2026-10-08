/**
 * Reply languages. Choosing one appends a "Reply in X." suffix to
 * the system prompt and sets the Latin-script voice locale. Groups keep the
 * requested order; every language renders as its chosen marker (flag emoji
 * for national languages, thematic emoji for classics).
 */

export interface ReplyLanguage {
	code: string;
	name: string;
	/** System-prompt suffix. */
	prompt: string;
	/** BCP-47 voice locale. Ancient languages use stated modern approximations. */
	voice: string;
	/** Clean badge content (ISO code or classic marker). */
	badge: string;
	/** Endonym for the reply pill ("Čeština"). */
	native: string;
	/** "Cleared" in that language, for the clear toast. */
	cleared: string;
}

const LANG = (
	code: string,
	name: string,
	voice: string,
	badge: string,
	native: string,
	cleared: string,
	prompt?: string
): ReplyLanguage => ({
	code,
	name,
	voice,
	badge,
	native,
	cleared,
	prompt: prompt ?? `Reply in ${name}.`
});

export const EUROPEAN_LANGUAGES: ReplyLanguage[] = [
	LANG("fr", "French", "fr-FR", "🇫🇷", "français", "Effacé"),
	LANG("de", "German", "de-DE", "🇩🇪", "Deutsch", "Gelöscht"),
	LANG("es", "Spanish", "es-ES", "🇪🇸", "Español", "Borrado"),
	LANG("pt", "Portuguese", "pt-PT", "🇵🇹", "Português", "Apagado"),
	LANG("ru", "Russian", "ru-RU", "🇷🇺", "Русский", "Сброшено"),
	LANG("pl", "Polish", "pl-PL", "🇵🇱", "Polski", "Wyczyszczono"),
	LANG("it", "Italian", "it-IT", "🇮🇹", "Italiano", "Cancellato"),
	LANG("no", "Norwegian", "nb-NO", "🇳🇴", "Norsk", "Nullstilt"),
	LANG("cs", "Czech", "cs-CZ", "🇨🇿", "Čeština", "Vymazáno"),
	LANG("el", "Greek", "el-GR", "🇬🇷", "Ελληνικά", "Διαγράφηκε"),
	LANG("ro", "Romanian", "ro-RO", "🇷🇴", "Română", "Șters"),
	LANG("bg", "Bulgarian", "bg-BG", "🇧🇬", "Български", "Изчистено"),
	LANG("hu", "Hungarian", "hu-HU", "🇭🇺", "Magyar", "Törölve"),
	LANG("uk", "Ukrainian", "uk-UA", "🇺🇦", "Українська", "Скинуто"),
	LANG("nl", "Dutch", "nl-NL", "🇳🇱", "Nederlands", "Gewist"),
	LANG("sv", "Swedish", "sv-SE", "🇸🇪", "Svenska", "Rensat"),
	LANG("da", "Danish", "da-DK", "🇩🇰", "Dansk", "Rydet"),
	LANG("fi", "Finnish", "fi-FI", "🇫🇮", "Suomi", "Tyhjennetty"),
	LANG("sr", "Serbian", "sr-RS", "🇷🇸", "Српски", "Obrisano"),
	LANG("sk", "Slovak", "sk-SK", "🇸🇰", "Slovenčina", "Vymazané"),
	LANG("is", "Icelandic", "is-IS", "🇮🇸", "Íslenska", "Hreinsað")
];

export const ASIAN_LANGUAGES: ReplyLanguage[] = [
	LANG("zh", "Chinese", "zh-CN", "🇹🇼", "中文", "已清除"),
	LANG("ja", "Japanese", "ja-JP", "🇯🇵", "日本語", "クリア"),
	LANG("ko", "Korean", "ko-KR", "🇰🇷", "한국어", "지워짐"),
	LANG("ar", "Arabic (MSA)", "ar-SA", "🇸🇦", "العربية", "تم المسح", "Reply in Modern Standard Arabic."),
	LANG("hi", "Hindi", "hi-IN", "🇮🇳", "हिन्दी", "साफ़ किया गया"),
	// No unclaimed flag (🇮🇳/🇵🇰 ride with Hindi/Urdu), so the
	// Gurmukhi initial marks it — still non-ASCII and menu-unique.
	LANG("pa", "Punjabi", "pa-IN", "ਪ", "ਪੰਜਾਬੀ", "ਸਾਫ਼ ਕੀਤਾ ਗਿਆ"),
	LANG("id", "Indonesian", "id-ID", "🇮🇩", "Bahasa Indonesia", "Dihapus"),
	LANG("tr", "Turkish", "tr-TR", "🇹🇷", "Türkçe", "Temizlendi"),
	LANG("fa", "Persian", "fa-IR", "🇮🇷", "فارسی", "پاک شد"),
	LANG("th", "Thai", "th-TH", "🇹🇭", "ไทย", "ล้างแล้ว"),
	LANG("vi", "Vietnamese", "vi-VN", "🇻🇳", "Tiếng Việt", "Đã xóa"),
	LANG("hy", "Armenian", "hy-AM", "🇦🇲", "Հայերեն", "Մաքրված է"),
	LANG("ur", "Urdu", "ur-PK", "🇵🇰", "اردو", "صاف کر دیا گیا"),
	LANG("he", "Hebrew", "he-IL", "🇮🇱", "עברית", "נוקה"),
	LANG("bn", "Bengali", "bn-BD", "🇧🇩", "বাংলা", "মুছে ফেলা হয়েছে"),
	LANG("ta", "Tamil", "ta-IN", "🇱🇰", "தமிழ்", "அழிக்கப்பட்டது"),
	LANG("tl", "Tagalog", "fil-PH", "🇵🇭", "Tagalog", "Na-clear"),
	LANG("ms", "Malay", "ms-MY", "🇲🇾", "Bahasa Melayu", "Dipadam"),
	LANG("yue", "Cantonese", "zh-HK", "🇭🇰", "粵語", "已清除", "Reply in Cantonese.")
];

export const CLASSICAL_LANGUAGES: ReplyLanguage[] = [
	LANG("la", "Latin", "it-IT", "🏛\uFE0F", "Latina", "Deletum", "Reply in Latin."),
	LANG("grc", "Ancient Greek", "el-GR", "🏺", "Ἀρχαία Ἑλληνικά", "Διαγέγραπται", "Reply in Ancient Greek."),
	LANG("sa", "Sanskrit", "hi-IN", "🪷", "संस्कृतम्", "विलुप्तम्", "Reply in Sanskrit."),
	// Voices are modern approximations (Icelandic for Old Norse,
	// British English for Old English, Iraqi Arabic for the
	// Mesopotamian isolates, Mandarin for Classical Chinese,
	// Israeli Hebrew for Biblical Hebrew); runes and cuneiform
	// badge them.
	LANG("non", "Old Norse", "is-IS", "ᚠ", "Norrœnt", "Hreinsat", "Reply in Old Norse."),
	LANG("ang", "Old English", "en-GB", "ᚦ", "Englisċ", "Āclǣnsod", "Reply in Old English."),
	LANG("sux", "Sumerian", "ar-SA", "𒆠", "Emegir", "dadag-ga", "Reply in Sumerian."),
	LANG("akk", "Babylonian", "ar-SA", "𒀭", "Akkadûm", "ebbu", "Reply in Babylonian."),
	LANG("lzh", "Classical Chinese", "zh-CN", "文", "文言文", "已清", "Reply in Classical Chinese."),
	LANG("hbo", "Biblical Hebrew", "he-IL", "📜", "עברית מקראית", "נמחה", "Reply in Biblical Hebrew.")
];

export const AFRICAN_LANGUAGES: ReplyLanguage[] = [
	LANG("sw", "Swahili", "sw-KE", "🇰🇪", "Kiswahili", "Imefutwa"),
	LANG("am", "Amharic", "am-ET", "🇪🇹", "አማርኛ", "ተሰርዟል")
];

export interface LanguageMenu {
	id: "europe" | "asia" | "africa" | "classics";
	marker: string;
	label: string;
	languages: ReplyLanguage[];
}

/** Anchor box for a language menu (see .lang-list-fixed). */
export interface LangMenuAnchor {
	left: number;
	maxH: number;
	top: number;
}

/**
 * Smart anchor for a language menu: every list drops under its own
 * pill like a plain menu, capped at the composer with an internal
 * scroll past maxH — one alignment for all four families, so long
 * lists hug their button exactly like short ones. A top/bottom
 * pair is forbidden — an over-constrained fixed box stretches
 * full-band (margins compute to zero), which reads as a massive
 * empty panel. Left edge stays pill-anchored, shifted to stay
 * on-screen. Pure and unit-tested.
 */
export function langMenuAnchorFor(opts: {
	btnLeft: number;
	btnBottom: number;
	composerTop: number;
	viewportWidth: number;
}): LangMenuAnchor {
	const dropTop = Math.round(opts.btnBottom + 6);
	return {
		left: Math.round(
			Math.max(8, Math.min(opts.btnLeft, opts.viewportWidth - 8 - 180))
		),
		maxH: Math.max(140, Math.round(opts.composerTop - dropTop - 8 - 8)),
		top: dropTop
	};
}

export const LANGUAGE_MENUS: LanguageMenu[] = [
	{
		id: "europe",
		marker: "🌍",
		label: "Europe",
		languages: EUROPEAN_LANGUAGES
	},
	{ id: "asia", marker: "🌏", label: "Asia", languages: ASIAN_LANGUAGES },
	{ id: "africa", marker: "🐘", label: "Africa", languages: AFRICAN_LANGUAGES },
	{
		id: "classics",
		marker: "🏛\uFE0F",
		label: "Classics",
		languages: CLASSICAL_LANGUAGES
	}
];

const BY_CODE: Record<string, ReplyLanguage> = {};
for (const menu of LANGUAGE_MENUS) {
	for (const lang of menu.languages) BY_CODE[lang.code] = lang;
}

export function replyLanguageFor(code: string | null): ReplyLanguage | null {
	if (!code) return null;
	return BY_CODE[code] ?? null;
}

/**
 * Priority quick-switch order for ⌘1…⌘0. Flags in order: FR DE ES CN JP PT
 * KR IQ IN RU. IQ maps to Modern Standard Arabic and IN to Hindi — the
 * menus carry no closer Iraqi/Indian entries.
 */
export const QUICK_LANG_CODES: readonly string[] = [
	"fr",
	"de",
	"es",
	"zh",
	"ja",
	"pt",
	"ko",
	"ar",
	"hi",
	"ru"
];

/** "⌘1"… "⌘9", "⌘0" (Mac) or "Ctrl+1"… "Ctrl+0" for a priority
 * language, else null. */
export function quickKeyFor(code: string, isMac = true): string | null {
	const idx = QUICK_LANG_CODES.indexOf(code);
	if (idx < 0) return null;
	const digit = idx === 9 ? "0" : String(idx + 1);
	return isMac ? `⌘${digit}` : `Ctrl+${digit}`;
}

/**
 * Sending-status "thinking" in the reply language (short status
 * forms, not dictionary headwords — native speakers: corrections
 * welcome). Unknown codes fall back to English.
 */
const THINKING_LABEL: Record<string, string> = {
	fr: "Réflexion",
	de: "Denken",
	es: "Pensando",
	pt: "Pensando",
	ru: "Думаю",
	pl: "Myślę",
	it: "Pensando",
	no: "Tenker",
	cs: "Myslím",
	el: "Σκέφτομαι",
	ro: "Mă gândesc",
	bg: "Мисля",
	hu: "Gondolkodom",
	uk: "Думаю",
	nl: "Denken",
	sv: "Tänker",
	da: "Tænker",
	fi: "Mietin",
	sr: "Мислим",
	sk: "Myslím",
	zh: "思考中",
	ja: "考え中",
	ko: "생각 중",
	ar: "تفكير",
	hi: "सोच रहे हैं",
	pa: "ਸੋਚ ਰਹੇ ਹਾਂ",
	id: "Berpikir",
	tr: "Düşünüyor",
	fa: "تفکر",
	th: "กำลังคิด",
	vi: "Đang nghĩ",
	hy: "Մտածում եմ",
	ur: "سوچ رہے ہیں",
	he: "חושב",
	bn: "ভাবছি",
	ta: "யோசிக்கிறேன்",
	tl: "Nag-iisip",
	ms: "Berfikir",
	sw: "Inafikiria",
	am: "እያሰብኩ",
	yue: "諗緊",
	la: "Cogito",
	grc: "Φρονῶ",
	sa: "चिन्तयामि",
	is: "Hugsar",
	non: "Hugsar",
	ang: "Þenceþ",
	lzh: "思",
	hbo: "חושב"
};
// Sumerian and Akkadian keep no thinking label (English fallback):
// coining short status forms risks wrong words worse than none.

/** Sending-status label for a reply-language code; English fallback. */
export function thinkingLabelFor(code: string | null): string {
	if (!code) return "Thinking";
	return THINKING_LABEL[code] ?? "Thinking";
}

/**
 * Language-switch toast: endonym plus marker ("Čeština 🇨🇿").
 * Shared by the submenu picks and the send-button hold swap so the
 * shape never drifts. Pure.
 */
export function switchToastFor(lang: ReplyLanguage): string {
	return `${lang.native} ${lang.badge}`;
}

/**
 * Display name for a voice tag ("Japanese" for ja-JP, bare tag when
 * the language is unknown): exact match, then the primary subtag.
 * Shared by the settings pickers so labels never drift. Pure.
 */
export function langNameForTag(tag: string): string {
	const trimmed = tag.trim();
	return (
		replyLanguageFor(trimmed)?.name ??
		replyLanguageFor(trimmed.split("-")[0] ?? "")?.name ??
		trimmed
	);
}

/**
 * Pill voice state: the applied pill code, the pre-pill voice it
 * overrides, and the effective voice tag plus its pin. The page
 * effect owns the reactive wiring; this step is the whole decision.
 */
export interface PillVoiceState {
	appliedPill: string | null;
	pillBaseVoice: string | null;
	voiceLang: string;
	voiceLangPinned: boolean;
}

/**
 * One step of the pill-follows-voice rule: a newly applied pill
 * installs its locale (unpinned, so a later launch without the pill
 * falls back); leaving the pill restores the pre-pill voice only
 * while it still matches the pill's — a manual pick the leaving
 * pill doesn't match stands untouched. Reruns with the same pill
 * are no-ops. Unknown pill codes never apply. Pure and unit-tested.
 */
export function stepPillVoice(
	state: PillVoiceState,
	activeCode: string | null,
	localeForCode: (code: string) => string | null
): PillVoiceState {
	if (activeCode === state.appliedPill) return state;
	const oldVoice = state.appliedPill
		? localeForCode(state.appliedPill)
		: null;
	const { pillBaseVoice } = state;
	let { voiceLang, voiceLangPinned } = state;
	if (oldVoice && pillBaseVoice !== null && voiceLang === oldVoice) {
		voiceLang = pillBaseVoice;
		voiceLangPinned = true;
	}
	if (!activeCode) {
		return { appliedPill: null, pillBaseVoice, voiceLang, voiceLangPinned };
	}
	const voice = localeForCode(activeCode);
	if (!voice) {
		return { appliedPill: null, pillBaseVoice, voiceLang, voiceLangPinned };
	}
	return {
		appliedPill: activeCode,
		pillBaseVoice: voiceLang,
		voiceLang: voice,
		voiceLangPinned: false
	};
}

/** "Expand on this part" in the learner's language (English where
 * the app has no wording yet, and for the classical languages). */
const EXPAND_ASK: Record<string, string> = {
	fr: "Développe ce passage.",
	de: "Erkläre diesen Teil ausführlicher.",
	es: "Amplía esta parte.",
	it: "Approfondisci questa parte.",
	pt: "Desenvolve esta parte.",
	ru: "Расскажи подробнее об этой части.",
	pl: "Rozwiń ten fragment.",
	nl: "Werk dit deel verder uit.",
	sv: "Utveckla den här delen.",
	no: "Utdyp denne delen.",
	da: "Uddyb denne del.",
	fi: "Kerro tästä kohdasta tarkemmin.",
	cs: "Rozveď tuto část.",
	sk: "Rozveď túto časť.",
	el: "Ανάπτυξε αυτό το σημείο.",
	ro: "Dezvoltă această parte.",
	bg: "Разкажи повече за тази част.",
	hu: "Fejtsd ki bővebben ezt a részt.",
	uk: "Розкажи докладніше про цю частину.",
	sr: "Објасни детаљније овај део.",
	is: "Útskýrðu þennan hluta nánar.",
	zh: "请详细展开这一部分。",
	yue: "可唔可以講多啲呢部分？",
	ja: "この部分をもっと詳しく説明して。",
	ko: "이 부분을 더 자세히 설명해 줘.",
	ar: "وسّع في هذا الجزء.",
	hi: "इस हिस्से को विस्तार से समझाओ।",
	tr: "Bu kısmı biraz daha aç.",
	fa: "این بخش را بیشتر توضیح بده.",
	he: "הרחב על החלק הזה.",
	id: "Jelaskan bagian ini lebih lanjut.",
	ms: "Huraikan bahagian ini dengan lebih lanjut.",
	vi: "Hãy nói rõ hơn về phần này.",
	th: "ช่วยขยายความส่วนนี้หน่อย",
	tl: "Ipaliwanag pa ang bahaging ito.",
	sw: "Eleza sehemu hii zaidi."
};

export function expandAskFor(code: string | null): string {
	return (code && EXPAND_ASK[code]) || "Expand on this part.";
}

/**
 * Composer text for "expand on this": the quote as a Markdown block
 * quote, a blank line, then the ask; appended under any draft. Pure.
 */
export function expandDraft(draft: string, quote: string, ask: string): string {
	const block = quote
		.trim()
		.split(/\r?\n/)
		.map((line) => `> ${line}`.trimEnd())
		.join("\n");
	const body = `${block}\n\n${ask}`;
	return draft.trim() ? `${draft.trimEnd()}\n\n${body}` : body;
}
