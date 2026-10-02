package studio.ccez.app.domain

/**
 * Reply languages (languages.ts parity). Choosing one appends a
 * "Reply in X." suffix to the system prompt and sets the Latin-script
 * voice locale. Groups keep the requested order; every language
 * renders as its chosen marker (flag emoji for national languages,
 * thematic emoji for classics).
 */
data class ReplyLanguage(
    val code: String,
    val name: String,
    val voice: String,
    val badge: String,
    val prompt: String = "Reply in $name.",
    /** Endonym for the reply pill ("Čeština"). */
    val native: String,
    /** "Cleared" in that language, for the clear toast. */
    val cleared: String,
)

private fun lang(
    code: String,
    name: String,
    voice: String,
    badge: String,
    native: String,
    cleared: String,
    prompt: String? = null,
): ReplyLanguage = ReplyLanguage(code, name, voice, badge, prompt ?: "Reply in $name.", native, cleared)

val EUROPEAN_LANGUAGES = listOf(
    lang("fr", "French", "fr-FR", "🇫🇷", "Français", "Effacé"),
    lang("de", "German", "de-DE", "🇩🇪", "Deutsch", "Gelöscht"),
    lang("es", "Spanish", "es-ES", "🇪🇸", "Español", "Borrado"),
    lang("pt", "Portuguese", "pt-PT", "🇵🇹", "Português", "Apagado"),
    lang("ru", "Russian", "ru-RU", "🇷🇺", "Русский", "Сброшено"),
    lang("pl", "Polish", "pl-PL", "🇵🇱", "Polski", "Wyczyszczono"),
    lang("it", "Italian", "it-IT", "🇮🇹", "Italiano", "Cancellato"),
    lang("no", "Norwegian", "nb-NO", "🇳🇴", "Norsk", "Nullstilt"),
    lang("cs", "Czech", "cs-CZ", "🇨🇿", "Čeština", "Vymazáno"),
    lang("el", "Greek", "el-GR", "🇬🇷", "Ελληνικά", "Διαγράφηκε"),
    lang("ro", "Romanian", "ro-RO", "🇷🇴", "Română", "Șters"),
    lang("bg", "Bulgarian", "bg-BG", "🇧🇬", "Български", "Изчистено"),
    lang("hu", "Hungarian", "hu-HU", "🇭🇺", "Magyar", "Törölve"),
    lang("uk", "Ukrainian", "uk-UA", "🇺🇦", "Українська", "Скинуто"),
    lang("nl", "Dutch", "nl-NL", "🇳🇱", "Nederlands", "Gewist"),
    lang("sv", "Swedish", "sv-SE", "🇸🇪", "Svenska", "Rensat"),
    lang("da", "Danish", "da-DK", "🇩🇰", "Dansk", "Rydet"),
    lang("fi", "Finnish", "fi-FI", "🇫🇮", "Suomi", "Tyhjennetty"),
    lang("sr", "Serbian", "sr-RS", "🇷🇸", "Српски", "Obrisano"),
    lang("sk", "Slovak", "sk-SK", "🇸🇰", "Slovenčina", "Vymazané"),
)

val ASIAN_LANGUAGES = listOf(
    lang("zh", "Chinese", "zh-CN", "🇹🇼", "中文", "已清除"),
    lang("ja", "Japanese", "ja-JP", "🇯🇵", "日本語", "クリア"),
    lang("ko", "Korean", "ko-KR", "🇰🇷", "한국어", "지워짐"),
    lang("ar", "Arabic (MSA)", "ar-SA", "🇸🇦", "العربية", "تم المسح", "Reply in Modern Standard Arabic."),
    lang("hi", "Hindi", "hi-IN", "🇮🇳", "हिन्दी", "साफ़ किया गया"),
    lang("id", "Indonesian", "id-ID", "🇮🇩", "Bahasa Indonesia", "Dihapus"),
    lang("tr", "Turkish", "tr-TR", "🇹🇷", "Türkçe", "Temizlendi"),
    lang("fa", "Persian", "fa-IR", "🇮🇷", "فارسی", "پاک شد"),
    lang("th", "Thai", "th-TH", "🇹🇭", "ไทย", "ล้างแล้ว"),
    lang("vi", "Vietnamese", "vi-VN", "🇻🇳", "Tiếng Việt", "Đã xóa"),
    lang("hy", "Armenian", "hy-AM", "🇦🇲", "Հայերեն", "Մաքրված է"),
    lang("ur", "Urdu", "ur-PK", "🇵🇰", "اردو", "صاف کر دیا گیا"),
    lang("he", "Hebrew", "he-IL", "🇮🇱", "עברית", "נוקה"),
    lang("bn", "Bengali", "bn-BD", "🇧🇩", "বাংলা", "মুছে ফেলা হয়েছে"),
    lang("ta", "Tamil", "ta-IN", "🇱🇰", "தமிழ்", "அழிக்கப்பட்டது"),
    lang("tl", "Tagalog", "fil-PH", "🇵🇭", "Tagalog", "Na-clear"),
    lang("ms", "Malay", "ms-MY", "🇲🇾", "Bahasa Melayu", "Dipadam"),
    lang("yue", "Cantonese", "zh-HK", "🇭🇰", "粵語", "已清除", "Reply in Cantonese."),
)

val CLASSICAL_LANGUAGES = listOf(
    lang("la", "Latin", "it-IT", "🏛", "Latina", "Deletum", "Reply in Latin."),
    lang("grc", "Ancient Greek", "el-GR", "🏺", "Ἀρχαία Ἑλληνικά", "Διαγέγραπται", "Reply in Ancient Greek."),
    lang("sa", "Sanskrit", "hi-IN", "🪷", "संस्कृतम्", "विलुप्तम्", "Reply in Sanskrit."),
)

val AFRICAN_LANGUAGES = listOf(
    lang("sw", "Swahili", "sw-KE", "🇰🇪", "Kiswahili", "Imefutwa"),
    lang("am", "Amharic", "am-ET", "🇪🇹", "አማርኛ", "ተሰርዟል"),
)

data class LanguageMenu(val id: String, val marker: String, val label: String, val languages: List<ReplyLanguage>)

val LANGUAGE_MENUS = listOf(
    LanguageMenu("europe", "🌍", "Europe", EUROPEAN_LANGUAGES),
    LanguageMenu("asia", "🌏", "Asia", ASIAN_LANGUAGES),
    LanguageMenu("africa", "🐘", "Africa", AFRICAN_LANGUAGES),
    LanguageMenu("classics", "🏛", "Classics", CLASSICAL_LANGUAGES),
)

private val BY_CODE: Map<String, ReplyLanguage> =
    LANGUAGE_MENUS.flatMap { it.languages }.associateBy { it.code }

/** Reply language for a per-chat code, or null when unset/unknown. */
fun replyLanguageFor(code: String?): ReplyLanguage? = if (code.isNullOrEmpty()) null else BY_CODE[code]

private val THINKING_LABEL = mapOf(
    "fr" to "Réflexion",
    "de" to "Denken",
    "es" to "Pensando",
    "pt" to "Pensando",
    "ru" to "Думаю",
    "pl" to "Myślę",
    "it" to "Pensando",
    "no" to "Tenker",
    "cs" to "Myslím",
    "el" to "Σκέφτομαι",
    "ro" to "Mă gândesc",
    "bg" to "Мисля",
    "hu" to "Gondolkodom",
    "uk" to "Думаю",
    "nl" to "Denken",
    "sv" to "Tänker",
    "da" to "Tænker",
    "fi" to "Mietin",
    "sr" to "Мислим",
    "sk" to "Myslím",
    "zh" to "思考中",
    "ja" to "考え中",
    "ko" to "생각 중",
    "ar" to "تفكير",
    "hi" to "सोच रहे हैं",
    "id" to "Berpikir",
    "tr" to "Düşünüyor",
    "fa" to "تفکر",
    "th" to "กำลังคิด",
    "vi" to "Đang nghĩ",
    "hy" to "Մտածում եմ",
    "ur" to "سوچ رہے ہیں",
    "he" to "חושב",
    "bn" to "ভাবছি",
    "ta" to "யோசிக்கிறேன்",
    "tl" to "Nag-iisip",
    "ms" to "Berfikir",
    "sw" to "Inafikiria",
    "am" to "እያሰብኩ",
    "yue" to "諗緊",
    "la" to "Cogito",
    "grc" to "Φρονῶ",
    "sa" to "चिन्तयामि",
)

/** Sending-status label for a reply-language code; English fallback. */
fun thinkingLabelFor(code: String?): String {
    if (code.isNullOrEmpty()) return "Thinking"
    return THINKING_LABEL[code] ?: "Thinking"
}

/**
 * Reply-language resolution: the per-chat pill wins, the global
 * settings default fills gaps (Tauri: chat.replyLang ?? settings.replyLang).
 */
fun effectiveReplyLang(chatLang: String?, defaultLang: String?): String? = chatLang ?: defaultLang

/**
 * Empty-state language pick: tapping the active language clears its
 * pill, any other valid code installs it (Tauri toggleLangMenu parity).
 * Unknown codes never reach the field.
 */
fun toggleReplyLang(current: String?, code: String): String? {
    if (replyLanguageFor(code) == null) return current
    return if (current == code) null else code
}

/** Send-button hold swap outcome: the new current language plus the stash. */
data class ReplyLangSwap(val current: String?, val stash: String?)

/**
 * Send-button hold swap (Tauri swapReplyLang parity): holding with a reply
 * language set stashes it and drops back to default; holding with none
 * restores the stash; neither is a no-op.
 */
fun swapReplyLang(current: String?, stash: String?): ReplyLangSwap {
    if (current != null) return ReplyLangSwap(null, current)
    if (stash != null) return ReplyLangSwap(stash, stash)
    return ReplyLangSwap(current, stash)
}
