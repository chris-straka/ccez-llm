package studio.ccez.app.domain

/**
 * Markdown → Compose blocks (render.ts parity, native architecture).
 *
 * The Tauri app renders markdown → sanitized HTML (marked + DOMPurify +
 * shiki + KaTeX). The native port parses to blocks directly: no HTML
 * round-trip means no sanitizer is needed (we never interpret markup),
 * and code/math render as native widgets with copy buttons.
 *
 * Pipeline mirrors render.ts: stripLatexFenceDupes → extractMath →
 * parse (placeholders resolve to Math nodes) → Compose.
 */
sealed interface MdBlock {
    data class Para(val inlines: List<MdInline>) : MdBlock
    data class Heading(val level: Int, val inlines: List<MdInline>) : MdBlock
    data class Code(val lang: String, val code: String) : MdBlock
    data class Quote(val blocks: List<MdBlock>) : MdBlock
    data class Bullets(val items: List<List<MdBlock>>) : MdBlock
    data class Numbered(val start: Int, val items: List<List<MdBlock>>) : MdBlock
    data object Hr : MdBlock
    data class Table(val headers: List<String>, val rows: List<List<String>>) : MdBlock
    /** Display math (from `$$` placeholders or lone latex fences). */
    data class Math(val tex: String) : MdBlock
}

sealed interface MdInline {
    data class Text(val text: String) : MdInline
    data class Strong(val inlines: List<MdInline>) : MdInline
    data class Em(val inlines: List<MdInline>) : MdInline
    data class Strike(val inlines: List<MdInline>) : MdInline
    data class Code(val code: String) : MdInline
    data class Link(val label: List<MdInline>, val url: String) : MdInline
    /** Inline math (from `$`/`\(\)` placeholders). */
    data class Math(val tex: String) : MdInline
    data object Br : MdInline
}

/** Full pipeline: dedupe latex, extract math, parse blocks. */
fun parseMessageMarkdown(source: String): Pair<List<MdBlock>, List<MathEntry>> {
    val deduped = stripLatexFenceDupes(source)
    val (stripped, maths) = extractMath(deduped)
    return parseMarkdownBlocks(stripped, maths) to maths
}

private fun mathInline(tex: String): MdInline.Math = MdInline.Math(tex)

/** Inline pass: code spans, math placeholders, links, strong/em/strike. */
fun parseInlines(text: String, maths: List<MathEntry>): List<MdInline> {
    if (text.isEmpty()) return emptyList()
    // Code spans shield everything inside.
    val codeRe = Regex("(`+)(.+?)\\1")
    val out = mutableListOf<MdInline>()
    var pos = 0
    data class Span(val start: Int, val end: Int, val inline: MdInline)
    val spans = mutableListOf<Span>()
    for (m in codeRe.findAll(text)) {
        if (m.groupValues[2].contains('\n')) continue
        spans.add(Span(m.range.first, m.range.last + 1, MdInline.Code(m.groupValues[2])))
    }
    // Math placeholders (private-use, collision-free by construction).
    for (m in MATH_PLACEHOLDER_RE.findAll(text)) {
        val entry = maths.getOrNull(m.groupValues[1].toIntOrNull() ?: -1) ?: continue
        if (entry.kind != MathEntry.Kind.INLINE) continue
        spans.add(Span(m.range.first, m.range.last + 1, mathInline(entry.tex)))
    }
    spans.sortBy { it.start }
    for (span in spans) {
        if (span.start < pos) continue
        if (span.start > pos) out.addAll(parseRichInlines(text.substring(pos, span.start)))
        out.add(span.inline)
        pos = span.end
    }
    if (pos < text.length) out.addAll(parseRichInlines(text.substring(pos)))
    return out
}

private val LINK_RE = Regex("\\[([^\\]]*)\\]\\(([^)\"]*)(?:\"[^\"]*\")?\\)")
private val AUTOLINK_RE = Regex("<(https?://[^>\\s]+)>")

private fun parseRichInlines(text: String): List<MdInline> {
    if (text.isEmpty()) return emptyList()
    val out = mutableListOf<MdInline>()
    var pos = 0
    data class R(val start: Int, val end: Int, val inline: MdInline)
    val found = mutableListOf<R>()
    for (m in LINK_RE.findAll(text)) {
        found.add(R(m.range.first, m.range.last + 1, MdInline.Link(parseRichInlines(m.groupValues[1]), m.groupValues[2].trim())))
    }
    for (m in AUTOLINK_RE.findAll(text)) {
        found.add(R(m.range.first, m.range.last + 1, MdInline.Link(listOf(MdInline.Text(m.groupValues[1])), m.groupValues[1])))
    }
    found.sortBy { it.start }
    for (r in found) {
        if (r.start < pos) continue
        if (r.start > pos) out.addAll(parseEmphasis(text.substring(pos, r.start)))
        out.add(r.inline)
        pos = r.end
    }
    if (pos < text.length) out.addAll(parseEmphasis(text.substring(pos)))
    return out
}

private fun parseEmphasis(text: String): List<MdInline> {
    if (text.isEmpty()) return emptyList()
    // Strong (**…** or __…__), then em (*…* or _…_), then strike (~~…~~).
    val strong = Regex("(\\*\\*|__)(.+?)\\1").find(text)
    if (strong != null) {
        return parseEmphasis(text.substring(0, strong.range.first)) +
            listOf(MdInline.Strong(parseEmphasis(strong.groupValues[2]))) +
            parseEmphasis(text.substring(strong.range.last + 1))
    }
    val em = Regex("(\\*|_)([^*_\\s][^*_]*?)\\1").find(text)
    if (em != null) {
        return parseEmphasis(text.substring(0, em.range.first)) +
            listOf(MdInline.Em(parseEmphasis(em.groupValues[2]))) +
            parseEmphasis(text.substring(em.range.last + 1))
    }
    val strike = Regex("~~(.+?)~~").find(text)
    if (strike != null) {
        return parseEmphasis(text.substring(0, strike.range.first)) +
            listOf(MdInline.Strike(parseEmphasis(strike.groupValues[1]))) +
            parseEmphasis(text.substring(strike.range.last + 1))
    }
    return listOf(MdInline.Text(text))
}

/** Block pass over placeholder-carrying source. */
fun parseMarkdownBlocks(source: String, maths: List<MathEntry>): List<MdBlock> {
    val lines = source.split("\n")
    val blocks = mutableListOf<MdBlock>()
    var i = 0
    fun mathBlockAt(line: String): MdBlock.Math? {
        val m = MATH_PLACEHOLDER_RE.find(line.trim()) ?: return null
        if (m.value != line.trim()) return null
        val entry = maths.getOrNull(m.groupValues[1].toIntOrNull() ?: -1) ?: return null
        return if (entry.kind == MathEntry.Kind.DISPLAY) MdBlock.Math(entry.tex) else null
    }
    while (i < lines.size) {
        val line = lines[i]
        val trimmed = line.trim()
        if (trimmed.isEmpty()) {
            i++
            continue
        }
        // Fenced code (lone latex fences become display math, like render.ts).
        if (trimmed.startsWith("```")) {
            val lang = trimmed.removePrefix("```").trim().lowercase()
            val body = mutableListOf<String>()
            i++
            while (i < lines.size && !lines[i].trim().startsWith("```")) {
                body.add(lines[i])
                i++
            }
            i++ // consume closer (or EOF)
            val code = body.joinToString("\n")
            if (lang == "latex") {
                blocks.add(MdBlock.Math(stripOuterDisplayDelimiters(code.ifBlank { "" }).ifBlank { code }))
            } else {
                blocks.add(MdBlock.Code(lang, code))
            }
            continue
        }
        mathBlockAt(trimmed)?.let {
            blocks.add(it)
            i++
            continue
        }
        val heading = Regex("^(#{1,6})\\s+(.+)$").find(trimmed)
        if (heading != null) {
            blocks.add(MdBlock.Heading(heading.groupValues[1].length, parseInlines(heading.groupValues[2], maths)))
            i++
            continue
        }
        if (Regex("^(-{3,}|\\*{3,}|_{3,})$").matches(trimmed)) {
            blocks.add(MdBlock.Hr)
            i++
            continue
        }
        if (trimmed.startsWith(">")) {
            val quote = mutableListOf<String>()
            while (i < lines.size && (lines[i].trim().startsWith(">") || lines[i].isBlank())) {
                quote.add(lines[i].trim().removePrefix(">").removePrefix(" "))
                if (lines[i].isBlank()) {
                    // Blank ends the quote only when the next line isn't quoted.
                    if (i + 1 >= lines.size || !lines[i + 1].trim().startsWith(">")) {
                        i++
                        break
                    }
                }
                i++
            }
            blocks.add(MdBlock.Quote(parseMarkdownBlocks(quote.joinToString("\n"), maths)))
            continue
        }
        val bullet = Regex("^\\s*[-*+]\\s+(.+)$").find(line)
        val numbered = Regex("^\\s*(\\d+)[.)]\\s+(.+)$").find(line)
        if (bullet != null || numbered != null) {
            val ordered = numbered != null
            val start = numbered?.groupValues?.get(1)?.toIntOrNull() ?: 1
            val items = mutableListOf<List<MdBlock>>()
            while (i < lines.size) {
                val b = Regex("^\\s*[-*+]\\s+(.+)$").find(lines[i])
                val n = Regex("^\\s*(\\d+)[.)]\\s+(.+)$").find(lines[i])
                val item = if (ordered) n else b
                if (item == null) break
                val text = if (ordered) item.groupValues[2] else item.groupValues[1]
                items.add(parseMarkdownBlocks(text, maths))
                i++
            }
            blocks.add(if (ordered) MdBlock.Numbered(start, items) else MdBlock.Bullets(items))
            continue
        }
        // Tables: header row plus a delimiter row.
        if ('|' in line && i + 1 < lines.size && Regex("^\\s*\\|?[\\s:|-]+\\|?[\\s:|-]*$").matches(lines[i + 1]) && lines[i + 1].contains('-')) {
            fun cells(row: String): List<String> =
                row.trim().removePrefix("|").removeSuffix("|").split("|").map { it.trim() }
            val headers = cells(line)
            i += 2
            val rows = mutableListOf<List<String>>()
            while (i < lines.size && '|' in lines[i] && lines[i].isNotBlank()) {
                rows.add(cells(lines[i]))
                i++
            }
            blocks.add(MdBlock.Table(headers, rows))
            continue
        }
        // Paragraph: run until a blank line or another block opener.
        val para = mutableListOf<String>()
        while (i < lines.size && lines[i].isNotBlank() &&
            !lines[i].trim().startsWith("```") &&
            !Regex("^(#{1,6})\\s").containsMatchIn(lines[i].trim()) &&
            !lines[i].trim().startsWith(">") &&
            Regex("^\\s*[-*+]\\s+.+$").find(lines[i]) == null &&
            Regex("^\\s*\\d+[.)]\\s+.+$").find(lines[i]) == null
        ) {
            para.add(lines[i].trim())
            i++
        }
        val text = para.joinToString("\n")
        val inlineOnly = MATH_PLACEHOLDER_RE.replace(text) { "" }.trim()
        if (inlineOnly.isEmpty() && MATH_PLACEHOLDER_RE.containsMatchIn(text)) {
            // A paragraph holding only display placeholders becomes math blocks.
            for (m in MATH_PLACEHOLDER_RE.findAll(text)) {
                val entry = maths.getOrNull(m.groupValues[1].toIntOrNull() ?: -1)
                if (entry != null && entry.kind == MathEntry.Kind.DISPLAY) blocks.add(MdBlock.Math(entry.tex))
            }
            continue
        }
        // Hard breaks and soft newlines both break the line.
        val paraInlines = mutableListOf<MdInline>()
        text.split("\n").forEachIndexed { li, part ->
            if (li > 0) paraInlines.add(MdInline.Br)
            paraInlines.addAll(parseInlines(part.trimEnd(), maths))
        }
        blocks.add(MdBlock.Para(paraInlines))
    }
    return blocks
}

/** Copy text for rendered blocks: code and math keep raw source. */
fun blocksToText(blocks: List<MdBlock>): String {
    val out = mutableListOf<String>()
    fun inlineText(inlines: List<MdInline>): String = inlines.joinToString("") { inline ->
        when (inline) {
            is MdInline.Text -> inline.text
            is MdInline.Strong -> inlineText(inline.inlines)
            is MdInline.Em -> inlineText(inline.inlines)
            is MdInline.Strike -> inlineText(inline.inlines)
            is MdInline.Code -> inline.code
            is MdInline.Link -> inlineText(inline.label)
            is MdInline.Math -> inline.tex
            MdInline.Br -> "\n"
        }
    }
    fun blockText(block: MdBlock) {
        when (block) {
            is MdBlock.Para -> out.add(inlineText(block.inlines))
            is MdBlock.Heading -> out.add(inlineText(block.inlines))
            is MdBlock.Code -> out.add(block.code)
            is MdBlock.Quote -> block.blocks.forEach { blockText(it) }
            is MdBlock.Bullets -> block.items.forEach { item -> item.forEach { blockText(it) } }
            is MdBlock.Numbered -> block.items.forEach { item -> item.forEach { blockText(it) } }
            MdBlock.Hr -> {}
            is MdBlock.Table -> {
                out.add(block.headers.joinToString(" | "))
                block.rows.forEach { out.add(it.joinToString(" | ")) }
            }
            is MdBlock.Math -> out.add(mathCopyText(block.tex))
        }
    }
    blocks.forEach { blockText(it) }
    return out.joinToString("\n\n")
}
