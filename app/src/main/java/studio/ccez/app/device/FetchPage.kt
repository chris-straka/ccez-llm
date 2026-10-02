package studio.ccez.app.device

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.Job
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import studio.ccez.app.domain.formatFeedItems
import studio.ccez.app.domain.htmlToText
import studio.ccez.app.domain.looksLikeFeed
import studio.ccez.app.domain.parseFeedItems
import studio.ccez.app.domain.validFetchUrl
import java.util.concurrent.TimeUnit

/**
 * Page-fetch executor behind the model's `fetch_url` tool.
 *
 * GET with a timeout and a byte cap, http/https only, no credentialed
 * URLs (mirrors fetch.rs: 20s, 512 KiB, `ccez-llm page fetch` agent).
 * The markup is cleaned to readable text here, so both legs share the
 * cap and the copy. Throws short one-sentence errors the turn loop
 * hands back to the model; a user stop still stops.
 */
class FetchPageError(message: String) : RuntimeException(message)

/** Largest page kept (bytes of HTML; the text cap lives in FetchTools). */
const val MAX_HTML_BYTES = 512L * 1024L

private val fetchHttp = OkHttpClient.Builder()
    .connectTimeout(20, TimeUnit.SECONDS)
    .readTimeout(20, TimeUnit.SECONDS)
    .callTimeout(20, TimeUnit.SECONDS)
    .build()

/**
 * Raw bounded GET (no cleaning): backing fetch for asset-like texts
 * the caller parses itself (KanjiVG SVGs). Same 20s/512KiB gate as
 * page fetch; HTTP failures throw FetchPageError, misses resolve null
 * at the caller's layer.
 */
suspend fun fetchRawText(url: String, http: OkHttpClient = fetchHttp): String {
    if (!validFetchUrl(url)) throw FetchPageError("That URL can't be fetched.")
    return fetchHtml(url, http)
}

/** Fetch + clean one page (or feed). Pure validation, impure transport. */
suspend fun fetchPageText(url: String, http: OkHttpClient = fetchHttp): String {
    if (!validFetchUrl(url)) throw FetchPageError("That URL can't be fetched.")
    val html = fetchHtml(url, http)
    if (looksLikeFeed(html)) {
        val text = formatFeedItems(parseFeedItems(html))
        if (text.isEmpty()) throw FetchPageError("That feed had no readable headlines.")
        return text
    }
    val text = htmlToText(html)
    if (text.isEmpty()) throw FetchPageError("That page had no readable text.")
    return text
}

private suspend fun fetchHtml(url: String, http: OkHttpClient): String =
    withContext(Dispatchers.IO) {
        val call = http.newCall(
            Request.Builder()
                .url(url)
                .header("User-Agent", "ccez-llm page fetch")
                .build(),
        )
        currentCoroutineContext()[Job]?.invokeOnCompletion { call.cancel() }
        val bytes: ByteArray
        val code: Int
        val ok: Boolean
        try {
            call.execute().use {
                ok = it.isSuccessful
                code = it.code
                if ((it.body?.contentLength() ?: -1) > MAX_HTML_BYTES) throw FetchPageError("That page is too large.")
                bytes = it.body?.bytes() ?: ByteArray(0)
            }
        } catch (e: FetchPageError) {
            throw e
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            // A user stop cancels the call mid-flight: still stop.
            if (!currentCoroutineContext()[Job]?.isActive!!) throw CancellationException("Reply stopped.")
            val msg = e.message ?: ""
            val timeout = e is java.net.SocketTimeoutException ||
                e is java.util.concurrent.TimeoutException ||
                Regex("timeout|timed out", RegexOption.IGNORE_CASE).containsMatchIn(msg)
            throw if (timeout) FetchPageError("That page took too long.")
            else FetchPageError("That page couldn't be fetched.")
        }
        if (!ok) throw FetchPageError("That page failed (HTTP $code).")
        if (bytes.size > MAX_HTML_BYTES) throw FetchPageError("That page is too large.")
        try {
            String(bytes, Charsets.UTF_8)
        } catch (_: Exception) {
            throw FetchPageError("That page couldn't be fetched.")
        }
    }
