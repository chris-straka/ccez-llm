package studio.ccez.app.domain

/**
 * LaTeX math codec (render-math.ts parity, minus KaTeX emission).
 *
 * The placeholder codec is the contract: math spans pull out of the
 * markdown source before parsing (marked would otherwise mangle the
 * tags), with identical guards — `$5 and $10` prices, `a$b` joins,
 * `$ x$` padding, ``` fences, and backtick spans all stay literal.
 * Native rendering shows styled TeX blocks with copy (copy text keeps
 * the `$$`/`$` delimiters); true typeset KaTeX is a TODO (WebView +
 * bundled KaTeX assets).
 */
data class MathEntry(
    val kind: Kind,
    /** Raw TeX between the delimiters (what Copy writes). */
    val tex: String,
    /** Full source slice including delimiters (plain fallback rendering). */
    val raw: String,
) {
    enum class Kind { DISPLAY, INLINE }
}

private const val MATH_OPEN = '\uE000'
private const val MATH_CLOSE = '\uE001'
val MATH_PLACEHOLDER_RE = Regex("\uE000(\\d+)\uE001")

fun mathPlaceholder(index: Int): String = "$MATH_OPEN$index$MATH_CLOSE"

/** Code-point-safe cut with the ellipsis marker (never a silent crop). */
fun cutPreview(text: String, max: Int): String {
    val points = text.codePoints().toArray()
    return if (points.size > max) String(points, 0, max) + "…" else text
}

fun mathTexPreview(tex: String, max: Int = 48): String {
    val flat = tex.replace(Regex("\\s+"), " ").trim()
    return cutPreview(flat, max)
}

/** Outer `$$…$$` delimiters off a fenced-latex body, when present. */
fun stripOuterDisplayDelimiters(text: String): String {
    val t = text.trim()
    if (t.startsWith("$$") && t.endsWith("$$") && t.length >= 4) return t.substring(2, t.length - 2).trim()
    return text
}

/** Equality key for duplicate latex: delimiters and whitespace aside. */
fun normMathSrc(text: String): String =
    stripOuterDisplayDelimiters(text).replace(Regex("\\s+"), " ").trim()

/** Copy text keeps its delimiters (`$$` display, `$` inline). */
fun mathCopyText(tex: String, kind: MathEntry.Kind = MathEntry.Kind.DISPLAY): String =
    if (kind == MathEntry.Kind.INLINE) "\$$tex\$" else "\$\$$tex\$\$"

/**
 * Drop a ```latex fence when an identical `$$` display block sits
 * right next to it (either order): models often emit both, and the
 * pair reads as the same equation twice.
 */
fun stripLatexFenceDupes(source: String): String {
    val fenceThenDisplay =
        Regex("^```latex[^\\S\\n]*\\n([\\s\\S]*?)\\n```[^\\S\\n]*(?:\\n[ \\t]*)*\\n(\\$\\$[\\s\\S]*?\\$\\$)", RegexOption.MULTILINE)
    val displayThenFence =
        Regex("(\\$\\$[\\s\\S]*?\\$\\$)(?:\\n[ \\t]*)*\\n```latex[^\\S\\n]*\\n([\\s\\S]*?)\\n```", RegexOption.MULTILINE)
    var out = fenceThenDisplay.replace(source) { m ->
        if (normMathSrc(m.groupValues[1]) == normMathSrc(m.groupValues[2])) m.groupValues[2] else m.value
    }
    out = displayThenFence.replace(out) { m ->
        if (normMathSrc(m.groupValues[1]) == normMathSrc(m.groupValues[2])) m.groupValues[1] else m.value
    }
    return out
}

/**
 * Pull math spans out of markdown source, skipping ``` fenced blocks
 * and backtick code spans. Returns placeholders plus entries in order.
 */
fun extractMath(markdownText: String): Pair<String, List<MathEntry>> {
    val maths = mutableListOf<MathEntry>()
    val out = StringBuilder()
    var i = 0
    val len = markdownText.length
    fun lineStart(pos: Int): Boolean = pos == 0 || markdownText[pos - 1] == '\n'
    while (i < len) {
        if (lineStart(i) && markdownText.startsWith("```", i)) {
            val openEnd = markdownText.indexOf('\n', i)
            val bodyStart = if (openEnd == -1) len else openEnd + 1
            var close = bodyStart
            var closeEnd = -1
            while (close < len) {
                val nl = markdownText.indexOf('\n', close)
                val lineEnd = if (nl == -1) len else nl
                if (Regex("^\\s*```\\s*$").matches(markdownText.substring(close, lineEnd))) {
                    closeEnd = if (nl == -1) len else nl + 1
                    break
                }
                close = lineEnd + 1
            }
            val end = if (closeEnd == -1) len else closeEnd
            out.append(markdownText.substring(i, end))
            i = end
            continue
        }
        val ch = markdownText[i]
        if (ch == '\\') {
            val next = markdownText.getOrNull(i + 1)
            if (next == '(') {
                val close = markdownText.indexOf("\\)", i + 2)
                if (close != -1) {
                    maths.add(MathEntry(MathEntry.Kind.INLINE, markdownText.substring(i + 2, close), markdownText.substring(i, close + 2)))
                    out.append(mathPlaceholder(maths.size - 1))
                    i = close + 2
                    continue
                }
            }
            out.append(markdownText.substring(i, minOf(i + 2, len)))
            i += if (next == null) 1 else 2
            continue
        }
        if (ch == '`') {
            var run = 1
            while (markdownText.getOrNull(i + run) == '`') run++
            val nl = markdownText.indexOf('\n', i)
            val lineEnd = if (nl == -1) len else nl
            val ticks = "`".repeat(run)
            val close = markdownText.indexOf(ticks, i + run)
            if (close != -1 && close < lineEnd) {
                out.append(markdownText.substring(i, close + run))
                i = close + run
                continue
            }
            out.append(markdownText.substring(i, i + run))
            i += run
            continue
        }
        if (ch == '$' && markdownText.getOrNull(i + 1) == '$') {
            val close = markdownText.indexOf("$$", i + 2)
            if (close != -1) {
                maths.add(MathEntry(MathEntry.Kind.DISPLAY, markdownText.substring(i + 2, close), markdownText.substring(i, close + 2)))
                out.append(mathPlaceholder(maths.size - 1))
                i = close + 2
                continue
            }
            out.append("$$")
            i += 2
            continue
        }
        if (ch == '$') {
            val prev = if (i == 0) "" else markdownText[i - 1].toString()
            val next = markdownText.getOrNull(i + 1)
            if (next != null && !next.isWhitespace() && !prev.matches(Regex("[A-Za-z0-9]"))) {
                var j = i + 1
                var close = -1
                while (j < len) {
                    if (markdownText[j] == '\\') {
                        j += 2
                        continue
                    }
                    if (markdownText[j] == '$') {
                        if (markdownText.getOrNull(j + 1) == '$') {
                            j += 2
                            continue
                        }
                        val before = markdownText.getOrNull(j - 1)?.toString() ?: " "
                        val after = markdownText.getOrNull(j + 1)?.toString() ?: ""
                        if (!before.matches(Regex("\\s")) && !after.matches(Regex("[A-Za-z0-9]"))) {
                            close = j
                            break
                        }
                    }
                    j++
                }
                if (close != -1) {
                    val tex = markdownText.substring(i + 1, close)
                    if (!tex.replace("\\$", "").contains('$')) {
                        maths.add(MathEntry(MathEntry.Kind.INLINE, tex, markdownText.substring(i, close + 1)))
                        out.append(mathPlaceholder(maths.size - 1))
                        i = close + 1
                        continue
                    }
                }
            }
            out.append('$')
            i++
            continue
        }
        out.append(ch)
        i++
    }
    return out.toString() to maths
}

private fun mathPreviewInner(lines: List<String>): String? {
    val first = (lines.getOrNull(0) ?: "").trim()
    for ((open, close) in listOf("$$" to "$$", "\\[" to "\\]")) {
        if (first.startsWith(open)) {
            var inner = first.substring(open.length)
            if (inner.endsWith(close)) inner = inner.substring(0, inner.length - close.length)
            if (inner.trim().isEmpty()) {
                val next = (lines.getOrNull(1) ?: "").trim()
                inner = if (next.endsWith(close)) next.substring(0, next.length - close.length) else next
            }
            return inner
        }
    }
    if (first.startsWith('$') && !first.startsWith("$$")) {
        val close = first.indexOf('$', 1)
        return if (close < 0) first.substring(1) else first.substring(1, close)
    }
    return null
}

/**
 * Boundaries before this many characters never end a folded preview: a
 * leading "Mr." or "はい。" is an abbreviation or a stub, not a
 * sentence — scanning continues to the next terminator instead.
 */
const val MIN_SENTENCE_CHARS = 8

/**
 * First-sentence head of a line (through its terminator), or null when
 * the line holds no boundary (Tauri render-math parity). CJK marks
 * (。！？．) always terminate; western . ! ? terminate only before
 * whitespace or end of line, so decimals never cut.
 */
fun firstSentence(line: String): String? {
    val pattern = Regex("[。！？．]|[.!?](?=\\s|$)")
    for (match in pattern.findAll(line)) {
        val end = match.range.last + 1
        if (line.substring(0, end).codePointCount(0, end) < MIN_SENTENCE_CHARS) continue
        return line.substring(0, end)
    }
    return null
}

/**
 * Folded-message preview: math folds into its TeX wrapped in `\(…\)`;
 * plain text lands on the first sentence (not the whole first line),
 * then the 140-code-point length rules (a short first line with more
 * below still earns the marker).
 */
fun foldPreviewText(content: String, override: String?): String {
    if (override != null) return override
    val lines = content.split("\n")
    val tex = mathPreviewInner(lines)
    if (tex != null) return "\\(${mathTexPreview(tex, 120)}\\)"
    val first = lines.getOrNull(0) ?: ""
    val sentence = firstSentence(first)
    if (sentence != null && sentence != first) return "$sentence…"
    val cut = cutPreview(first, 140)
    if (cut == first && lines.drop(1).joinToString("\n").trim().isNotEmpty()) return "$first…"
    return cut
}
