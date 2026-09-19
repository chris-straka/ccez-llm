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
}

const LANG = (
	code: string,
	name: string,
	voice: string,
	badge: string,
	prompt?: string
): ReplyLanguage => ({
	code,
	name,
	voice,
	badge,
	prompt: prompt ?? `Reply in ${name}.`
});

export const EUROPEAN_LANGUAGES: ReplyLanguage[] = [
	LANG("fr", "French", "fr-FR", "🇫🇷"),
	LANG("de", "German", "de-DE", "🇩🇪"),
	LANG("es", "Spanish", "es-ES", "🇪🇸"),
	LANG("pt", "Portuguese", "pt-PT", "🇵🇹"),
	LANG("ru", "Russian", "ru-RU", "🇷🇺"),
	LANG("pl", "Polish", "pl-PL", "🇵🇱"),
	LANG("it", "Italian", "it-IT", "🇮🇹"),
	LANG("no", "Norwegian", "nb-NO", "🇳🇴"),
	LANG("cs", "Czech", "cs-CZ", "🇨🇿"),
	LANG("el", "Greek", "el-GR", "🇬🇷"),
	LANG("ro", "Romanian", "ro-RO", "🇷🇴"),
	LANG("bg", "Bulgarian", "bg-BG", "🇧🇬"),
	LANG("hu", "Hungarian", "hu-HU", "🇭🇺"),
	LANG("uk", "Ukrainian", "uk-UA", "🇺🇦"),
	LANG("nl", "Dutch", "nl-NL", "🇳🇱"),
	LANG("sv", "Swedish", "sv-SE", "🇸🇪"),
	LANG("da", "Danish", "da-DK", "🇩🇰"),
	LANG("fi", "Finnish", "fi-FI", "🇫🇮"),
	LANG("sr", "Serbian", "sr-RS", "🇷🇸"),
	LANG("sk", "Slovak", "sk-SK", "🇸🇰")
];

export const ASIAN_LANGUAGES: ReplyLanguage[] = [
	LANG("zh", "Chinese", "zh-CN", "🇹🇼"),
	LANG("ja", "Japanese", "ja-JP", "🇯🇵"),
	LANG("ko", "Korean", "ko-KR", "🇰🇷"),
	LANG("ar", "Arabic (MSA)", "ar-SA", "🇸🇦", "Reply in Modern Standard Arabic."),
	LANG("hi", "Hindi", "hi-IN", "🇮🇳"),
	LANG("id", "Indonesian", "id-ID", "🇮🇩"),
	LANG("tr", "Turkish", "tr-TR", "🇹🇷"),
	LANG("fa", "Persian", "fa-IR", "🇮🇷"),
	LANG("th", "Thai", "th-TH", "🇹🇭"),
	LANG("vi", "Vietnamese", "vi-VN", "🇻🇳"),
	LANG("hy", "Armenian", "hy-AM", "🇦🇲"),
	LANG("ur", "Urdu", "ur-PK", "🇵🇰"),
	LANG("he", "Hebrew", "he-IL", "🇮🇱"),
	LANG("bn", "Bengali", "bn-BD", "🇧🇩"),
	LANG("ta", "Tamil", "ta-IN", "🇱🇰"),
	LANG("tl", "Tagalog", "fil-PH", "🇵🇭"),
	LANG("ms", "Malay", "ms-MY", "🇲🇾"),
	LANG("yue", "Cantonese", "zh-HK", "🇭🇰", "Reply in Cantonese.")
];

export const CLASSICAL_LANGUAGES: ReplyLanguage[] = [
	LANG("la", "Latin", "it-IT", "🏛", "Reply in Latin."),
	LANG("grc", "Ancient Greek", "el-GR", "🏺", "Reply in Ancient Greek."),
	LANG("sa", "Sanskrit", "hi-IN", "🪷", "Reply in Sanskrit.")
];

export const AFRICAN_LANGUAGES: ReplyLanguage[] = [
	LANG("sw", "Swahili", "sw-KE", "🇰🇪"),
	LANG("am", "Amharic", "am-ET", "🇪🇹")
];

export interface LanguageMenu {
	id: "europe" | "asia" | "africa" | "classics";
	marker: string;
	label: string;
	languages: ReplyLanguage[];
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
		marker: "🏛",
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

/** "⌘1"… "⌘9", "⌘0" for a priority language, else null. */
export function quickKeyFor(code: string): string | null {
	const idx = QUICK_LANG_CODES.indexOf(code);
	if (idx < 0) return null;
	return idx === 9 ? "⌘0" : `⌘${idx + 1}`;
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
	sa: "चिन्तयामि"
};

/** Sending-status label for a reply-language code; English fallback. */
export function thinkingLabelFor(code: string | null): string {
	if (!code) return "Thinking";
	return THINKING_LABEL[code] ?? "Thinking";
}
