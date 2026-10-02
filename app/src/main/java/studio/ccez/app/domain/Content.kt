package studio.ccez.app.domain

import java.text.BreakIterator
import java.util.Locale

// ---- Full-text search (chatSearch.ts parity) ----

data class SearchDoc(
    val chatId: String,
    val msgId: String? = null,
    val kind: Kind = Kind.MESSAGE,
    val text: String = "",
) {
    enum class Kind { CHAT, MESSAGE, ANNOTATION }
}

data class SearchHit(val doc: SearchDoc, val score: Int, val snippet: String)

/** Segment text into lowercase word-like tokens (BreakIterator ~ Intl.Segmenter word). */
fun tokenizeText(text: String): List<String> {
    val lowered = text.lowercase()
    return try {
        val it = BreakIterator.getWordInstance(Locale.ROOT)
        it.setText(lowered)
        val out = mutableListOf<String>()
        var start = it.first()
        var end = it.next()
        while (end != BreakIterator.DONE) {
            val token = lowered.substring(start, end).trim()
            if (token.isNotEmpty() && token.any { ch -> ch.isLetterOrDigit() }) out.add(token)
            start = end
            end = it.next()
        }
        out.ifEmpty { lowered.split(Regex("[\\s\\p{P}]+")).filter { t -> t.isNotEmpty() } }
    } catch (_: Exception) {
        lowered.split(Regex("[\\s\\p{P}]+")).filter { t -> t.isNotEmpty() }
    }
}

/** One-line context around the first query-token occurrence. */
fun snippetFor(text: String, queryTokens: List<String>, radius: Int = 40): String {
    val flat = text.replace(Regex("\\s+"), " ").trim()
    if (flat.isEmpty()) return ""
    val lower = flat.lowercase()
    var at = -1
    for (token in queryTokens) {
        val hit = lower.indexOf(token)
        if (hit >= 0 && (at < 0 || hit < at)) at = hit
    }
    if (at < 0) return flat.take(radius * 2)
    val start = maxOf(0, at - radius)
    val end = minOf(flat.length, at + radius)
    return (if (start > 0) "…" else "") + flat.substring(start, end) + (if (end < flat.length) "…" else "")
}

private fun scoreDoc(tokens: List<String>, queryTokens: List<String>): Int {
    if (queryTokens.isEmpty()) return 0
    val counts = mutableMapOf<String, Int>()
    for (token in tokens) counts[token] = (counts[token] ?: 0) + 1
    var score = 0
    for (query in queryTokens) {
        if (counts.containsKey(query)) {
            score += 2 * (counts[query] ?: 0)
            continue
        }
        var partial = 0
        for ((token, count) in counts) {
            if (token.startsWith(query) || query.startsWith(token)) partial += count
        }
        if (partial == 0) return 0
        score += partial
    }
    return score
}

/** Message indices containing the query (case-insensitive substring): the in-chat find bar. */
fun findMessageIndices(contents: List<String>, query: String): List<Int> {
    val q = query.trim().lowercase()
    if (q.isEmpty()) return emptyList()
    return contents.mapIndexedNotNull { index, content -> if (content.lowercase().contains(q)) index else null }
}

/** Rank documents against a raw query string (AND semantics), highest score first. */
fun querySearch(docs: List<SearchDoc>, query: String, limit: Int = 30): List<SearchHit> {
    val queryTokens = tokenizeText(query)
    if (queryTokens.isEmpty()) return emptyList()
    return docs.mapNotNull { doc ->
        val score = scoreDoc(tokenizeText(doc.text), queryTokens)
        if (score <= 0) null else SearchHit(doc, score, snippetFor(doc.text, queryTokens))
    }.sortedByDescending { it.score }.take(limit)
}

// ---- Chat export (chatExport.ts parity) ----

data class ExportMsg(
    val role: String,
    val content: String,
    val attachments: List<String> = emptyList(),
)

/**
 * One chat as Markdown: `## You` / `## Assistant` sections with
 * attachments listed under their message. Pure and deterministic.
 */
fun chatToMarkdown(messages: List<ExportMsg>): String {
    val lines = mutableListOf("# Chat export", "")
    if (messages.isEmpty()) {
        lines.add("(empty chat)")
        lines.add("")
        return lines.joinToString("\n")
    }
    messages.forEachIndexed { index, message ->
        if (index > 0) {
            lines.add("---")
            lines.add("")
        }
        lines.add(if (message.role == "assistant") "## Assistant" else "## You")
        lines.add("")
        val text = stripAttachmentMarkers(message.content).replace(Regex("\\s+$"), "")
        lines.add(if (text.isNotEmpty()) text else "(no text)")
        lines.add("")
        for (name in message.attachments) lines.add("- Attachment: $name")
        if (message.attachments.isNotEmpty()) lines.add("")
    }
    return lines.joinToString("\n")
}

/** Suggested export name: `chat-YYYY-MM-DD.md`. */
fun exportFilename(at: Long = System.currentTimeMillis()): String {
    val date = java.text.SimpleDateFormat("yyyy-MM-dd", Locale.US).apply {
        timeZone = java.util.TimeZone.getTimeZone("UTC")
    }.format(java.util.Date(at))
    return "chat-$date.md"
}

// ---- Attachments (attachments.ts parity, pure subset) ----

const val IMAGE_MARKER = "[Pasted image]"
const val FILE_MARKER = "[Pasted Attachment]"
const val IMAGE_MAX_DIM = 1568
val PASTED_TAG_RE = Regex("\\[Pasted (\\d+) chars]")

/** Rough token estimate for plain text (~4 chars per token). */
fun estimateTextTokens(text: String): Int = maxOf(1, (text.length + 3) / 4)

/** OpenAI-style vision estimate: base cost plus per-512px-tile cost. */
fun imageTokens(width: Int, height: Int): Int {
    val tiles = ((width + 511) / 512) * ((height + 511) / 512)
    return 85 + 170 * maxOf(1, tiles)
}

/** Target dimensions fitting inside IMAGE_MAX_DIM, preserving aspect ratio. */
fun fitDimensions(width: Int, height: Int): Pair<Int, Int> {
    val scale = minOf(1.0, IMAGE_MAX_DIM.toDouble() / maxOf(width, height))
    return maxOf(1, (width * scale).toInt()) to maxOf(1, (height * scale).toInt())
}

/** Cap inlined file text so one attachment can't blow the context window. */
const val MAX_FILE_CHARS = 100_000

fun capFileText(text: String, max: Int = MAX_FILE_CHARS): String =
    if (text.length > max) text.substring(0, max) else text

/**
 * Power-of-two BitmapFactory sample size so the decoded image already
 * fits inside maxDim; the exact fit happens via scaling afterwards.
 */
fun inSampleSizeFor(srcWidth: Int, srcHeight: Int, maxDim: Int = IMAGE_MAX_DIM): Int {
    var sample = 1
    while (maxOf(srcWidth / sample, srcHeight / sample) > maxDim) sample *= 2
    return sample
}

private val TEXT_MIME_PREFIXES = listOf("text/")
private val TEXT_MIMES = setOf(
    "application/json", "application/javascript", "application/typescript",
    "application/x-sh", "application/yaml", "application/toml", "application/xml",
)
private val TEXT_EXTENSIONS = setOf(
    "txt", "md", "markdown", "json", "js", "ts", "tsx", "jsx", "mjs", "cjs",
    "py", "rb", "go", "rs", "java", "c", "h", "cpp", "hpp", "cs", "swift",
    "kt", "php", "sh", "bash", "zsh", "yaml", "yml", "toml", "xml", "html",
    "css", "scss", "sql", "csv", "tsv", "log", "ini", "cfg", "conf", "env",
    "dockerfile", "gitignore", "svelte", "vue",
)

/** True when a dropped file should inline as text instead of an image. */
fun isTextAttachment(name: String, mime: String): Boolean {
    if (TEXT_MIME_PREFIXES.any { mime.startsWith(it) }) return true
    if (TEXT_MIMES.contains(mime)) return true
    val ext = name.substringAfterLast('.', "").lowercase()
    return TEXT_EXTENSIONS.contains(ext)
}

/** Remove marker tags from one line, also eating one trailing space per tag. */
fun removeTags(line: String): String {
    val tags = listOf(IMAGE_MARKER, FILE_MARKER)
    val hits = mutableListOf<IntRange>()
    for (tag in tags) {
        var at = line.indexOf(tag)
        while (at >= 0) {
            var end = at + tag.length
            if (end < line.length && line[end] == ' ') end += 1
            hits.add(at until end)
            at = line.indexOf(tag, end)
        }
    }
    for (m in PASTED_TAG_RE.findAll(line)) {
        var end = m.range.last + 1
        if (end < line.length && line[end] == ' ') end += 1
        hits.add(m.range.first until end)
    }
    if (hits.isEmpty()) return line
    val sorted = hits.sortedBy { it.first }
    val out = StringBuilder()
    var cursor = 0
    for (r in sorted) {
        if (r.first < cursor) continue
        out.append(line, cursor, r.first)
        cursor = r.last + 1
    }
    out.append(line, cursor, line.length)
    return out.toString()
}

/** Lines holding only marker tags drop out; the rest export clean. */
fun stripAttachmentMarkers(text: String): String =
    text.split("\n").mapNotNull { line ->
        if (!line.contains(IMAGE_MARKER) && !line.contains(FILE_MARKER)) line
        else {
            val out = removeTags(line)
            if (out.trim().isEmpty()) null else out
        }
    }.joinToString("\n")

// ---- Paste (editorPaste.ts parity, pure subset) ----

/** Pastes longer than this become a pasted-text unit. */
const val PASTE_THRESHOLD = 100

fun pastedLabel(chars: Int): String = "[Pasted $chars chars]"

/** Expand/collapse-all target from tag counts alone. */
fun pasteToggleAction(collapsed: Int, open: Int): String {
    if (collapsed > 0) return "expand"
    if (open > 0) return "collapse"
    return "none"
}

/** True when a fresh paste should fold instead of inlining. */
fun shouldFoldPaste(chars: Int, threshold: Int = PASTE_THRESHOLD): Boolean = chars > threshold
