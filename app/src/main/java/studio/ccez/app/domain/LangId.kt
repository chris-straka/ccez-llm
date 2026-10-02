package studio.ccez.app.domain

import java.util.Locale

/**
 * Offline language identification (langId.ts parity): non-Latin
 * scripts resolve by Unicode script; Latin scripts score the same
 * stop-word lists. Lists must match src/lib/langId.ts and
 * src-tauri/src/langid.rs so all shells agree.
 */

/** Minimum Latin tokens before a sample counts as classifiable. */
const val LANG_ID_MIN_WORDS = 10

/** Minimum winning stop-word hits before a sample counts as identified. */
const val LANG_ID_MIN_SCORE = 2

private val STOP_WORDS: List<Pair<String, List<String>>> = listOf(
    "en-US" to listOf(
        "the", "and", "that", "have", "with", "this", "from", "they", "would", "there", "are", "you", 
        "your", "yours", "our", "ours", "them", "their", "theirs", "it", "its", "were", "has", 
        "had", "shall", "should", "can", "cannot", "could", "must", "may", "might", "does", "did", 
        "done", "each", "other", "such", "than", "then", "these", "those", "when", "where", 
        "which", "while", "who", "whom", "whose", "because", "about", "into", "over", "under", 
        "between", "both", "few", "more", "most", "some", "only", "own", "same", "too", "very", 
        "often", "always", "never", "every", "all", "to", "for", "not", "what", "out", "here", 
        "how", "why", "now",
    ),
    "fr-FR" to listOf(
        "les", "des", "une", "que", "est", "dans", "pour", "vous", "avec", "pas", "la", "le", "un", "du", 
        "au", "aux", "et", "sont", "ont", "fait", "tout", "tous", "toute", "toutes", "cette", 
        "ces", "ses", "mes", "leur", "leurs", "notre", "votre", "mon", "sous", "suis", "sommes", 
        "êtes", "où", "ça", "mais", "entre",
    ),
    "de-DE" to listOf(
        "der", "die", "und", "den", "von", "mit", "ist", "das", "sich", "nicht", "eine", "einer", "einem", 
        "einen", "eines", "ein", "auch", "noch", "nur", "schon", "sehr", "mehr", "oder", "aber", 
        "wenn", "dann", "weil", "wird", "werden", "sind", "haben", "hatte", "hatten", "wurde", 
        "wurden", "kein", "keine", "keiner", "keinen", "dieser", "diese", "dieses", "diesen", 
        "diesem", "jeder", "jede", "jedes", "jeden", "allem", "aller", "alles", "beim", "zum", 
        "zur", "vom", "aus", "bei", "nach", "durch", "gegen", "ohne", "zwischen", "bis", "zu", 
        "vor", "hinter", "neben", "seit", "statt", "trotz", "während", "wegen", "für", "über", 
        "dich", "euch", "uns",
    ),
    "es-ES" to listOf(
        "los", "las", "una", "que", "está", "para", "con", "por", "como", "pero", "la", "un", "el", "unos", 
        "unas", "sino", "aunque", "porque", "donde", "dónde", "cuando", "cuándo", "cómo", "qué", 
        "cuál", "están", "este", "esta", "estos", "estas", "eso", "esa", "aquí", "muy", "también", 
        "siempre", "nunca", "más", "menos", "hasta", "desde", "sobre", "contra", "según", 
        "durante", "mediante", "hacia", "tras", "bajo", "entre", "mes", "del", "al", "poco", 
        "cosa",
    ),
    "it-IT" to listOf(
        "che", "una", "della", "sono", "come", "più", "anche", "nostra", "questo", "molto", "la", "le", 
        "un", "uno", "di", "dello", "degli", "delle", "del", "al", "dal", "dallo", "dalla", "dai", 
        "dagli", "dalle", "nel", "nello", "nella", "nei", "negli", "nelle", "sul", "sullo", 
        "sulla", "sui", "sugli", "sulle", "non", "quando", "è", "ho", "hai", "dove", "perché", 
        "poiché", "mentre", "tanto", "troppo", "poco", "tutto", "tutti", "ogni", "questa", 
        "questi", "queste", "quello", "quella", "stesso", "stessa", "sopra", "sotto", "dentro", 
        "fuori", "senza", "contro", "verso", "durante", "secondo", "oltre", "attraverso", "lungo", 
        "presso", "circa", "quasi", "forse", "sempre", "mai", "già", "ancora", "appena", "insieme", 
        "meno", "bene", "cosa", "niente", "nulla", "qualcosa", "qualcuno", "altro", "altra", 
        "altri", "altre",
    ),
    "pt-PT" to listOf(
        "que", "uma", "para", "com", "não", "como", "mais", "seus", "entre", "muito", "ao", "aos", "numa", 
        "este", "esta", "estes", "estas", "esse", "essa", "isso", "isto", "aquele", "aquela", 
        "aquilo", "menos", "desde", "sobre", "nunca", "sempre", "tanto", "quando", "porque", 
        "tudo", "todos", "todas", "todo", "toda", "cada", "qual", "quais", "onde", "pois", "é", 
        "são", "está", "estão", "embora", "também", "ainda", "já", "até", "tão", "segundo", 
        "durante", "através", "sem",
    ),
    "nl-NL" to listOf(
        "van", "het", "een", "dat", "die", "voor", "met", "zijn", "niet", "ook", "ik", "wij", "jullie", 
        "zij", "ze", "mij", "jou", "jouw", "hem", "haar", "hen", "hun", "ons", "dit", "deze", 
        "daar", "waar", "wanneer", "hoe", "één", "waarom", "omdat", "terwijl", "maar", "dus", 
        "toch", "wel", "te", "geen", "nooit", "altijd", "soms", "vaak", "alleen", "samen", 
        "tussen", "zonder", "naar", "uit", "tegen", "tijdens", "volgens", "wegens", "dankzij",
        "ondanks", "behalve", "naast", "boven", "onder", "langs", "tenzij", "zodat", "zodra",
        "voordat", "nadat", "totdat", "alsof", "evenals", "mits", "zelfs", "zelf", "elkaar",
    ),
)

/** Lowercase Latin tokens (langId.ts parity: accents kept, ASCII apostrophes stripped). */
fun latinTokens(text: String): List<String> =
    text.lowercase(Locale.US)
        .replace("'", "")
        .split(Regex("[^a-zà-ÿ]+"))
        .filter { it.isNotEmpty() }

/** Stop-word hits per language for already-tokenized text. */
fun stopCounts(tokens: List<String>): Map<String, Int> =
    STOP_WORDS.associate { (lang, words) ->
        lang to words.sumOf { word -> tokens.count { it == word } }
    }

/** French word list: shared stop words never veto the tiebreak below. */
private val FR_WORDS: Set<String> =
    STOP_WORDS.firstOrNull { it.first == "fr-FR" }?.second?.toSet() ?: emptySet()

/** How many stop-word lists own each word (langId.ts parity). */
private val STOP_WORD_OWNERS: Map<String, Int> = buildMap {
    for ((_, words) in STOP_WORDS) {
        for (word in words.toSet()) {
            put(word, (get(word) ?: 0) + 1)
        }
    }
}

/**
 * French default for a scoreless or contested fragment (langId.ts
 * parity): single tapped words like "révise" never reach the word
 * minimum, and bare é ties French/Spanish/Italian — so a fragment
 * with French-leaning diacritics reads French unless another
 * language shows exclusive evidence of its own. Bare è/à/ù-only
 * stays out (Italian "è", "città" keep their fallback).
 */
private fun frenchTiebreak(tokens: List<String>, trimmed: String): String? {
    if (tokens.none { Regex("[éêëâîïôçœæ]").containsMatchIn(it) }) return null
    if (tokens.any { Regex("[áíóúüñãõìòäöß]").containsMatchIn(it) }) return null
    if (Regex(" [A-ZÀ-Þ]").containsMatchIn(trimmed)) return null
    if (tokens.any { it !in FR_WORDS && (STOP_WORD_OWNERS[it] ?: 0) > 0 }) return null
    return "fr-FR"
}

internal data class Lead(val lang: String?, val score: Int, val margin: Int)

/** Leading entry and its margin over the runner-up. */
private fun leadLang(counts: Map<String, Int>): Lead {
    var best: String? = null
    var bestScore = 0
    var second = 0
    for ((lang, score) in counts) {
        if (score > bestScore) {
            second = bestScore
            bestScore = score
            best = lang
        } else if (score > second) {
            second = score
        }
    }
    return Lead(best, bestScore, bestScore - second)
}

/**
 * BCP-47 tag for `text`, or null when it cannot be told apart
 * (too short or unscorable — callers keep their fallback voice).
 */
fun identifyLangOffline(text: String): String? {
    val trimmed = text.trim()
    if (trimmed.isEmpty()) return null
    val scriptLang = ttsLangFor(trimmed, "")
    if (scriptLang.isNotEmpty()) return scriptLang
    val tokens = latinTokens(trimmed)
    if (tokens.size < LANG_ID_MIN_WORDS) return null
    val (lang, score) = leadLang(stopCounts(tokens)).let { it.lang to it.score }
    if (lang == null || score < LANG_ID_MIN_SCORE) return null
    return lang
}

/**
 * Short-sample identification for single sentences and highlights:
 * stop-word hits plus orthographic votes (diacritics, ß, elisions,
 * German mid-sentence capitals and noun suffixes, Dutch ij). Needs a
 * score of 2 with a clear margin; an exclusive stop-word hit decides
 * contests ("avec un tiret"), and past that the French tiebreak
 * still claims French-diacritic fragments with no exclusive
 * other-language evidence ("révise", "essuyât"). Else null and
 * callers keep their seed voice.
 */
fun identifyLangShort(text: String): String? {
    val trimmed = text.trim()
    if (trimmed.isEmpty()) return null
    val scriptLang = ttsLangFor(trimmed, "")
    if (scriptLang.isNotEmpty()) return scriptLang
    val tokens = latinTokens(trimmed)
    if (tokens.isEmpty()) return null
    val counts = stopCounts(tokens).toMutableMap()
    fun bump(lang: String, n: Int) {
        counts[lang] = (counts[lang] ?: 0) + n
    }
    // German: ß and umlauts, capitalized nouns past the first word,
    // characteristic noun/adjective suffixes on longer words. Capitals
    // read off the raw text: tokens arrive lowercased.
    if (Regex("ß", RegexOption.IGNORE_CASE).containsMatchIn(trimmed)) bump("de-DE", 3)
    // Umlauts barely occur outside German, so one is already a vote.
    if (tokens.any { Regex("[äöü]").containsMatchIn(it) }) bump("de-DE", 2)
    val rawWords = trimmed.split(Regex("[^A-Za-zÀ-ÿ]+")).filter { it.isNotEmpty() }
    val caps = rawWords.drop(1).count { Regex("^[A-ZÀ-Þ][a-zà-ÿ]+$").matches(it) }
    bump("de-DE", minOf(3, caps))
    val deSuffix = tokens.count {
        it.length > 4 && Regex("(ung|heit|keit|isch|lich|los|bar|sam|haft|tum)$").containsMatchIn(it)
    }
    bump("de-DE", minOf(2, deSuffix))
    // French: accented words, guillemets, single-letter elisions
    // (raw text: tokenizing strips straight apostrophes).
    val frWords = tokens.count { Regex("[éèêëàâîïôùûçœæ]").containsMatchIn(it) }
    bump("fr-FR", minOf(3, frWords))
    if (Regex("[«»]").containsMatchIn(trimmed)) bump("fr-FR", 2)
    val elisions = Regex("\\b[ldcjnmqstvy]['’]", RegexOption.IGNORE_CASE).findAll(trimmed).count()
    bump("fr-FR", minOf(2, elisions))
    // Spanish: ñ, accented vowels, inverted marks.
    if (Regex("ñ", RegexOption.IGNORE_CASE).containsMatchIn(trimmed)) bump("es-ES", 3)
    val esWords = tokens.count { Regex("[áéíóúü]").containsMatchIn(it) }
    bump("es-ES", minOf(3, esWords))
    if (Regex("[¿¡]").containsMatchIn(trimmed)) bump("es-ES", 2)
    // Italian and Portuguese: accented vowels.
    val itWords = tokens.count { Regex("[àèéìòù]").containsMatchIn(it) }
    bump("it-IT", minOf(3, itWords))
    val ptWords = tokens.count { Regex("[ãõâêô]").containsMatchIn(it) }
    bump("pt-PT", minOf(3, ptWords))
    // Dutch: ij inside words.
    val ijWords = tokens.count { Regex("ij").containsMatchIn(it) }
    bump("nl-NL", minOf(3, ijWords))
    val (lang, score, margin) = leadLang(counts)
    // A lone hit with no contest still reads on a tiny fragment
    // (der Hund, the cat); anything longer or contested needs a
    // real lead.
    if (lang == null) return null
    if (score < 2) {
        if (score == 1 && margin == 1 && tokens.size <= 4) return lang
        return frenchTiebreak(tokens, trimmed)
    }
    if (margin < 2 && score < 3) {
        // Contested but decided: a stop word the leader alone owns
        // breaks the tie ("avec" is only French); shared-only hits
        // fall through to the French tiebreak (langId.ts parity).
        val leaderWords =
            STOP_WORDS.firstOrNull { it.first == lang }?.second?.toSet() ?: emptySet()
        val decided = tokens.any { it in leaderWords && STOP_WORD_OWNERS[it] == 1 }
        if (!decided) return frenchTiebreak(tokens, trimmed)
    }
    return lang
}

/**
 * Language for a quote or sentence: script detection, then the full
 * scorer, then the short orthographic pass, else the fallback. Never
 * null.
 */
fun quoteLangFor(quote: String, fallback: String): String {
    if (hasPinyinTones(quote)) return "zh-CN"
    return identifyLangOffline(quote) ?: identifyLangShort(quote) ?: fallback
}

