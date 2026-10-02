package studio.ccez.app.device

import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import org.junit.Assert.*
import org.junit.Test
import java.net.ServerSocket
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * fetchPageText against a hand-rolled loopback HTTP server
 * (com.sun.net.httpserver is not on the unit-test classpath).
 */
class FetchPageTest {
    private data class Route(val code: Int, val body: ByteArray, val reason: String = "OK")

    private class Loopback(routes: Map<String, Route>) : AutoCloseable {
        private val socket = ServerSocket(0, 50, java.net.InetAddress.getByName("127.0.0.1"))
        val port: Int get() = socket.localPort
        private val alive = java.util.concurrent.atomic.AtomicBoolean(true)
        private val worker = thread(isDaemon = true) {
            while (alive.get()) {
                val conn = try {
                    socket.accept()
                } catch (_: Exception) {
                    return@thread
                }
                thread(isDaemon = true) {
                    conn.use { c ->
                        val reader = c.getInputStream().bufferedReader()
                        val line = try {
                            reader.readLine() ?: return@thread
                        } catch (_: Exception) {
                            return@thread
                        }
                        val path = line.split(" ").getOrNull(1) ?: "/"
                        var contentLength = 0
                        try {
                            while (true) {
                                val header = reader.readLine() ?: break
                                if (header.isEmpty()) break
                                if (header.startsWith("Content-Length:", ignoreCase = true)) {
                                    contentLength = header.substringAfter(":").trim().toIntOrNull() ?: 0
                                }
                            }
                            repeat(contentLength) { reader.read() }
                        } catch (_: Exception) {
                        }
                        val route = routes[path] ?: Route(404, "nope".toByteArray(), "Not Found")
                        val out = c.getOutputStream()
                        val head = "HTTP/1.1 ${route.code} ${route.reason}\r\n" +
                            "Content-Length: ${route.body.size}\r\nConnection: close\r\n\r\n"
                        out.write(head.toByteArray())
                        out.write(route.body)
                        out.flush()
                    }
                }
            }
        }

        fun url(path: String) = "http://127.0.0.1:$port$path"

        override fun close() {
            alive.set(false)
            runCatching { socket.close() }
            worker.join(2000)
        }
    }

    private val http = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .callTimeout(5, TimeUnit.SECONDS)
        .build()

    @Test fun `article html cleans to readable text`() = runTest {
        Loopback(
            mapOf("/p" to Route(200, "<html><body><nav>menu</nav><article><p>Hello world</p></article></body></html>".toByteArray())),
        ).use {
            assertEquals("Hello world", fetchPageText(it.url("/p"), http))
        }
    }

    @Test fun `feeds return headlines`() = runTest {
        val feed = """<rss version="2.0"><channel>
            <item><title>One</title><link>https://a.example/1</link></item>
        </channel></rss>""".toByteArray()
        Loopback(mapOf("/f" to Route(200, feed))).use {
            assertEquals("- One (https://a.example/1)", fetchPageText(it.url("/f"), http))
        }
    }

    @Test fun `http errors read one line`() = runTest {
        Loopback(emptyMap()).use {
            try {
                fetchPageText(it.url("/m"), http)
                fail("expected throw")
            } catch (e: FetchPageError) {
                assertTrue(e.message!!.contains("404"))
            }
        }
    }

    @Test fun `oversize pages are refused`() = runTest {
        val big = ByteArray((MAX_HTML_BYTES + 8).toInt()) { 'a'.code.toByte() }
        Loopback(mapOf("/b" to Route(200, big))).use {
            try {
                fetchPageText(it.url("/b"), http)
                fail("expected throw")
            } catch (e: FetchPageError) {
                assertEquals("That page is too large.", e.message)
            }
        }
    }

    @Test fun `bad urls never hit the network`() = runTest {
        try {
            fetchPageText("file:///etc/passwd", http)
            fail("expected throw")
        } catch (e: FetchPageError) {
            assertEquals("That URL can't be fetched.", e.message)
        }
    }
}
