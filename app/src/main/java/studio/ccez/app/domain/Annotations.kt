package studio.ccez.app.domain

import java.util.UUID

/** Opaque annotation identifier (same trick as ChatId/ChatMsgId). */
@JvmInline value class AnnotationId(val value: String)

fun newAnnotationId(): AnnotationId = AnnotationId(UUID.randomUUID().toString())

/**
 * Annotation: a quoted selection plus an optional comment, baked into
 * the next query on send. Drafts persist per chat; baked blocks never do.
 */
data class Annotation(
    val id: AnnotationId = newAnnotationId(),
    val messageId: ChatMsgId,
    val quote: String,
    val comment: String = "",
    val aidScope: String? = null,
    val at: Int = 0,
)

fun addAnnotation(list: List<Annotation>, messageId: ChatMsgId, quote: String, comment: String = ""): List<Annotation> {
    val trimmed = quote.trim()
    if (trimmed.isEmpty()) return list
    return list + Annotation(messageId = messageId, quote = trimmed, comment = comment)
}

/**
 * Rewrite a pending note in place (badge-tap parity): blank quotes
 * and unknown ids return the list untouched.
 */
fun editAnnotation(list: List<Annotation>, id: AnnotationId, quote: String, comment: String): List<Annotation> {
    val trimmed = quote.trim()
    if (trimmed.isEmpty()) return list
    if (list.none { it.id == id }) return list
    return list.map { if (it.id == id) it.copy(quote = trimmed, comment = comment) else it }
}

/** Tashkeel-scoped quotes only badge while the aid is on; unscoped quotes always show. */
fun aidMarkVisible(aidScope: String?, tashkeelOn: Boolean): Boolean =
    aidScope != "tashkeel" || tashkeelOn

/**
 * Id of the saved annotation already quoting the same span of the same
 * message (same text, same repeat): annotating it again would stack
 * two badges on one anchor. Null when the quote is blank.
 */
fun duplicateAnnotationId(list: List<Annotation>, messageId: ChatMsgId, quote: String, at: Int = 0): AnnotationId? {
    val trimmed = quote.trim()
    if (trimmed.isEmpty()) return null
    return list.find { it.messageId == messageId && it.quote == trimmed && it.at == at }?.id
}

/** One baked annotation reference, as displayed under its message. */
data class AnnotationRef(val n: Int, val quote: String, val comment: String)

private val ENTRY_RE = Regex("(\\d+)\\.\\s+\"([\\s\\S]*?)\"(?:\\s+—\\s+([^\\n]*))?(?=\\n\\d+\\.\\s+\"|$)")

/** Numbered reference lines for the baked block. Empty comments file as "?" so the model sees the confusion. */
fun formatAnnotations(list: List<Pair<String, String>>): String =
    list.mapIndexed { i, (quote, comment) ->
        val head = "${i + 1}. \"$quote\""
        if (comment.trim().isNotEmpty()) "$head — ${comment.trim()}" else "$head — ?"
    }.joinToString("\n")

/** Append the annotation block to outgoing prompt text. */
fun withAnnotations(prompt: String, list: List<Pair<String, String>>): String {
    if (list.isEmpty()) return prompt
    val block = "Annotated selections:\n${formatAnnotations(list)}"
    return if (prompt.isNotEmpty()) "$prompt\n\n$block" else block
}

data class SplitBlock(val text: String, val refs: List<AnnotationRef>)

/**
 * Split a sent message into display text plus its baked annotation
 * block. Null when no clean trailing block is present — the message
 * then renders untouched (including user-typed lookalikes).
 */
fun splitAnnotationBlock(content: String): SplitBlock? {
    val marker = "\n\nAnnotated selections:\n"
    val head = "Annotated selections:\n"
    val at = content.lastIndexOf(marker)
    val text: String
    val body: String
    if (at != -1) {
        text = content.substring(0, at)
        body = content.substring(at + marker.length)
    } else if (content.startsWith(head)) {
        text = ""
        body = content.substring(head.length)
    } else return null
    val refs = ENTRY_RE.findAll(body).map { m ->
        AnnotationRef(
            n = m.groupValues[1].toIntOrNull() ?: 0,
            quote = m.groupValues[2],
            comment = m.groupValues[3].trim(),
        )
    }.toList()
    if (refs.isEmpty()) return null
    val covered = ENTRY_RE.findAll(body).last().range.last + 1
    if (body.substring(covered).trim().isNotEmpty()) return null
    return SplitBlock(text, refs)
}

/** Strip every baked annotation, returning the bare prompt (null when no clean block). */
fun clearBakedAnnotations(content: String): String? = splitAnnotationBlock(content)?.text

/** Rewrite one baked ref's comment; numbering re-sequences so unchanged comments rebake byte-for-byte. */
fun rewriteAnnotationComment(content: String, n: Int, comment: String): String? {
    val split = splitAnnotationBlock(content) ?: return null
    if (split.refs.none { it.n == n }) return null
    return withAnnotations(split.text, split.refs.map { if (it.n == n) it.quote to comment else it.quote to it.comment })
}

/** Body shown for a message holding ONLY a baked block; stored content stays full. */
const val REFS_ONLY_BODY = "—"

/** Copy redacts the baked block; refs-only bodies fall back to the quotes. */
fun redactedCopyText(body: String): String {
    val split = if (body.contains("Annotated selections:")) splitAnnotationBlock(body) else null
    if (split == null) return body
    if (split.text.trim().isNotEmpty()) return split.text
    return split.refs.joinToString("\n") { it.quote }
}

/** True when a baked block is the message's whole content. */
fun isRefsOnly(content: String): Boolean {
    val split = if (content.contains("Annotated selections:")) splitAnnotationBlock(content) else null
    return split != null && split.text.trim().isEmpty()
}

/**
 * Quote-mark ranges over rendered text (applyMarks parity, static form:
 * touch has no hover wash, so quoted spans keep a badge tint). Every
 * occurrence of every quote marks; overlapping hits merge. Empty or
 * blank quotes never mark.
 */
fun quoteMarkRanges(text: String, quotes: List<String>): List<IntRange> {
    val hits = mutableListOf<IntRange>()
    for (quote in quotes) {
        if (quote.isBlank()) continue
        var from = 0
        while (true) {
            val at = text.indexOf(quote, from)
            if (at < 0) break
            hits.add(at..at + quote.length - 1)
            from = at + quote.length
        }
    }
    if (hits.isEmpty()) return emptyList()
    val sorted = hits.sortedBy { it.first }
    val merged = mutableListOf(sorted[0])
    for (hit in sorted.drop(1)) {
        val last = merged.last()
        if (hit.first <= last.last + 1) merged[merged.lastIndex] = last.first..maxOf(last.last, hit.last)
        else merged.add(hit)
    }
    return merged
}

/** Shape-checked draft restore: corrupt entries drop, valid ones restore. */
fun cleanDraftList(raw: List<Map<String, String?>>): List<Annotation> =
    raw.mapNotNull { item ->
        val id = item["id"] ?: return@mapNotNull null
        val messageId = item["messageId"] ?: return@mapNotNull null
        val quote = item["quote"] ?: return@mapNotNull null
        val comment = item["comment"] ?: return@mapNotNull null
        Annotation(AnnotationId(id), ChatMsgId(messageId), quote, comment)
    }
