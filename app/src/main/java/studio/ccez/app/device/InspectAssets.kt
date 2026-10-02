package studio.ccez.app.device

import android.content.Context
import okhttp3.OkHttpClient
import okhttp3.Request
import studio.ccez.app.domain.InspectTables
import studio.ccez.app.domain.StrokeCache
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPInputStream

/**
 * Inspect table loading: gzipped JSON assets (converted from the
 * generated TS, never hand-edited), parsed once per process.
 */
private var cachedTables: InspectTables? = null

@Synchronized
fun loadInspectTables(context: Context): InspectTables {
    cachedTables?.let { return it }
    fun readAsset(name: String): String {
        context.assets.open(name).use { stream ->
            GZIPInputStream(stream).use { gz ->
                return gz.bufferedReader(Charsets.UTF_8).readText()
            }
        }
    }
    return InspectTables.load(readAsset("unihan.json.gz"), readAsset("cjkdecomp.json.gz"))
        .also { cachedTables = it }
}

private val kanjiHttp = OkHttpClient.Builder()
    .connectTimeout(20, TimeUnit.SECONDS)
    .readTimeout(20, TimeUnit.SECONDS)
    .callTimeout(20, TimeUnit.SECONDS)
    .build()

/** Process-level stroke cache (parity with the web module-level map). */
val strokeCache = StrokeCache { url ->
    try {
        kanjiHttp.newCall(
            Request.Builder().url(url).header("User-Agent", "ccez-llm inspect").build(),
        ).execute().use {
            if (!it.isSuccessful) null else it.body?.string()
        }
    } catch (_: Exception) {
        null
    }
}
