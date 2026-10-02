package studio.ccez.app.domain

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.jsoup.Jsoup
import org.w3c.dom.Element
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Model-driven web lookup: the `fetch_url` tool the chat endpoint can
 * call mid-turn, so the MODEL fetches pages — the user never pastes
 * markup. Wire shape is OpenAI function-calling (`tools` /
 * `tool_calls` / `tool` messages); providers without tool support
 * simply never call it. Mirrors tools.ts.
 */
const val FETCH_TOOL_NAME = "fetch_url"

/** Longest URL the tool accepts (guards log spam, not a security line). */
const val MAX_FETCH_URL_CHARS = 2048

/** Longest page text kept per fetch (chars; the head wins). */
const val MAX_FETCH_TEXT_CHARS = 12_000

/** Most feed items kept per fetch (headlines first). */
const val MAX_FEED_ITEMS = 15

/** Longest item description kept (chars). */
const val MAX_FEED_DESC_CHARS = 200

/** Follow-up fetch rounds after the first streaming turn. */
const val MAX_TOOL_ROUNDS = 3

/** Fetch calls executed per round (head wins). */
const val MAX_CALLS_PER_ROUND = 3

/** One parsed tool call off the wire; null when not a fetch call. */
data class FetchCall(val id: String, val url: String)

/** One parsed feed headline. */
data class FeedItem(val title: String, val link: String, val description: String)

/** One raw tool call off the chat wire. */
data class WireToolCall(val id: String, val name: String, val arguments: String)

/** OpenAI function definition wired into chat requests. */
fun fetchToolDefinition(): Map<String, Any?> = mapOf(
    "type" to "function",
    "function" to mapOf(
        "name" to FETCH_TOOL_NAME,
        // Invisible plumbing (tools.ts parity): the user doesn't know the
        // tool exists, and the definition names no example feed URLs.
        "description" to "Fetch a web page and return its readable text. Use this when the user asks about a URL or " +
            "when current/external facts would answer better than training data. The user doesn't know it exists. " +
            "Do not use it when no external information is required. It returns the page text " +
            "(truncated when long) or a one-line error — never raw HTML. " +
            "RSS/Atom feeds work too and are the best route to recent news: a feed returns its latest " +
            "headlines as one line each. Prefer a feed URL you know for the outlet asked about.",
        "parameters" to mapOf(
            "type" to "object",
            "properties" to mapOf(
                "url" to mapOf("type" to "string", "description" to "The full http(s) URL to fetch."),
            ),
            "required" to listOf("url"),
        ),
    ),
)

/**
 * True for fetchable URLs: http/https only, no credentials, no
 * whitespace. Pure — the executor trusts nothing else.
 */
fun validFetchUrl(raw: Any?): Boolean {
    if (raw !is String) return false
    if (raw.isEmpty() || raw.length > MAX_FETCH_URL_CHARS) return false
    if (raw.any { it <= ' ' || it == '\u007f' }) return false
    val lower = raw.lowercase()
    val after = lower.removePrefix("http://").let {
        if (it.length != lower.length) it
        else lower.removePrefix("https://").takeIf { stripped -> stripped.length != lower.length }
            ?: return false
    }
    val host = after.substringBefore('/')
    if (host.isEmpty() || '@' in host) return false
    return true
}

/**
 * True for feed markup (RSS `<rss>`/`<item>`, Atom `<feed>`/`<entry>`).
 * Pure string gate — the parser below decides for real.
 */
fun looksLikeFeed(text: String): Boolean {
    val head = text.take(2000).lowercase()
    return "<rss" in head || "<feed" in head ||
        ("<?xml" in head && ("<item" in head || "<entry" in head))
}

/** Local name without a namespace prefix. */
private fun localName(tag: String): String = tag.substringAfter(':')

/**
 * Headlines out of RSS/Atom markup: title, link, description per
 * item, head wins. Malformed feeds yield what parses (possibly
 * nothing) — never throw. XXE-hardened (no doctypes/entities).
 */
fun parseFeedItems(markup: String): List<FeedItem> {
    val factory = DocumentBuilderFactory.newInstance().apply {
        isNamespaceAware = true
        setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
        setFeature("http://xml.org/sax/features/external-general-entities", false)
        setFeature("http://xml.org/sax/features/external-parameter-entities", false)
        isExpandEntityReferences = false
    }
    val doc = try {
        factory.newDocumentBuilder().parse(markup.byteInputStream())
    } catch (_: Exception) {
        return emptyList()
    }
    // Namespace-agnostic on purpose (Atom rides a default namespace).
    val items = doc.getElementsByTagName("item")
    val entries = if (items.length > 0) items else doc.getElementsByTagNameNS("*", "entry")
    val plainEntries = if (entries.length > 0) entries else doc.getElementsByTagName("entry")
    val out = mutableListOf<FeedItem>()
    for (i in 0 until plainEntries.length) {
        if (out.size >= MAX_FEED_ITEMS) break
        val node = plainEntries.item(i) as? Element ?: continue
        val kids = node.childNodes
        var title = ""
        var link = ""
        var description = ""
        for (k in 0 until kids.length) {
            val el = kids.item(k) as? Element ?: continue
            when (localName(el.localName ?: el.tagName)) {
                "title" -> if (title.isEmpty()) title = el.textContent.trim()
                "link" -> if (link.isEmpty()) {
                    link = el.textContent.trim().takeIf { it.isNotEmpty() }
                        ?: el.getAttribute("href").trim()
                }
                "description", "summary" -> if (description.isEmpty()) description = el.textContent.trim()
            }
        }
        if (title.isEmpty()) continue
        out.add(FeedItem(title, link, description.take(MAX_FEED_DESC_CHARS)))
    }
    return out
}

fun formatFeedItems(items: List<FeedItem>): String = items.joinToString("\n") { item ->
    val head = if (item.description.isNotEmpty()) "${item.title} — ${item.description}" else item.title
    if (item.link.isNotEmpty()) "- $head (${item.link})" else "- $head"
}.take(MAX_FETCH_TEXT_CHARS)

/**
 * Readable text out of a page's HTML: prefers `<article>`/`<main>`,
 * drops scripts, styles, nav, headers, footers, forms, and templates,
 * then collapses whitespace. Returns "" when nothing readable
 * remains.
 */
fun htmlToText(html: String): String {
    val doc = try {
        Jsoup.parse(html)
    } catch (_: Exception) {
        return ""
    }
    doc.select("script, style, noscript, nav, header, footer, form, template, svg, canvas, iframe")
        .forEach { it.remove() }
    val root = doc.selectFirst("article") ?: doc.selectFirst("main") ?: doc.body()
    val text = (root?.wholeText() ?: "")
        .split("\n")
        .map { line -> line.replace(Regex("[ \\t\\u00a0]+"), " ").trim() }
        .filter { it.isNotEmpty() }
        .joinToString("\n")
    return text.take(MAX_FETCH_TEXT_CHARS)
}

/** Short host label for progress UI ("example.com" out of a full URL). Pure. */
fun String.hostLabel(): String =
    substringAfter("://", this).substringBefore("/").substringBefore("?").takeIf { it.isNotEmpty() } ?: this

/** One tool call off the wire (`{id, url}`); null when not a fetch call. Pure. */
fun parseFetchCall(id: Any?, name: Any?, arguments: Any?): FetchCall? {
    if (id !is String || id.isEmpty()) return null
    if (name != FETCH_TOOL_NAME) return null
    val url = try {
        Json.parseToJsonElement(if (arguments is String) arguments else "").jsonObject
            .get("url")?.jsonPrimitive?.contentOrNull ?: ""
    } catch (_: Exception) {
        return null
    }
    if (!validFetchUrl(url)) return null
    return FetchCall(id, url)
}
