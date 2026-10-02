package studio.ccez.app.domain

import org.junit.Assert.*
import org.junit.Test

class LanguagesTest {
    @Test fun `codes resolve to prompt suffixes and badges`() {
        val ja = replyLanguageFor("ja")!!
        assertEquals("Japanese", ja.name)
        assertEquals("ja-JP", ja.voice)
        assertEquals("🇯🇵", ja.badge)
        assertEquals("Reply in Japanese.", ja.prompt)
        assertEquals("Reply in Modern Standard Arabic.", replyLanguageFor("ar")!!.prompt)
        assertEquals("Reply in Cantonese.", replyLanguageFor("yue")!!.prompt)
        assertNull(replyLanguageFor(null))
        assertNull(replyLanguageFor(""))
        assertNull(replyLanguageFor("xx"))
    }

    @Test fun `chat pill wins over the global reply default`() {
        assertEquals("ja", effectiveReplyLang("ja", "fr"))
        assertEquals("fr", effectiveReplyLang(null, "fr"))
        assertNull(effectiveReplyLang(null, null))
    }

    @Test fun `language pick toggles and rejects unknown codes`() {
        assertEquals("ja", toggleReplyLang(null, "ja"))
        assertNull(toggleReplyLang("ja", "ja"))
        assertEquals("fr", toggleReplyLang("ja", "fr"))
        assertEquals("ja", toggleReplyLang("ja", "xx"))
        assertNull(toggleReplyLang(null, "xx"))
    }

    @Test fun `send hold stashes the language and drops to default`() {
        assertEquals(ReplyLangSwap(null, "ja"), swapReplyLang("ja", null))
        assertEquals(ReplyLangSwap("ja", "ja"), swapReplyLang(null, "ja"))
        assertEquals(ReplyLangSwap(null, null), swapReplyLang(null, null))
        // A set language always wins over a stale stash.
        assertEquals(ReplyLangSwap(null, "fr"), swapReplyLang("fr", "ja"))
    }

    @Test fun `every language has an endonym and a cleared word`() {
        for (lang in EUROPEAN_LANGUAGES + ASIAN_LANGUAGES + CLASSICAL_LANGUAGES + AFRICAN_LANGUAGES) {
            assertTrue(lang.native.trim().isNotEmpty())
            assertTrue(lang.cleared.trim().isNotEmpty())
        }
        assertEquals("Čeština", replyLanguageFor("cs")?.native)
        assertEquals("Vymazáno", replyLanguageFor("cs")?.cleared)
        assertEquals("日本語", replyLanguageFor("ja")?.native)
    }

    @Test fun `thinking labels localize with english fallback`() {
        assertEquals("Thinking", thinkingLabelFor(null))
        assertEquals("Thinking", thinkingLabelFor("xx"))
        assertEquals("考え中", thinkingLabelFor("ja"))
        assertEquals("思考中", thinkingLabelFor("zh"))
        assertEquals("تفكير", thinkingLabelFor("ar"))
        assertEquals("Cogito", thinkingLabelFor("la"))
    }
}

class ThinkingTest {
    @Test fun `tables match provider and model`() {
        val muse = thinkingFor("muse", "muse-spark-1.3-contributor")
        assertEquals(listOf("minimal", "low", "medium", "high", "xhigh"), muse.options.map { it.id })
        assertEquals("medium", muse.defaultId)
        val ds = thinkingFor("deepseek", "deepseek-flash")
        assertEquals(listOf("off", "high", "max"), ds.options.map { it.id })
        assertEquals("high", ds.defaultId)
        val custom = thinkingFor("custom", "anything")
        assertEquals(listOf("low", "medium", "high"), custom.options.map { it.id })
        assertFalse(custom.native)
    }

    @Test fun `saved ids clamp to the dial`() {
        val muse = thinkingFor("muse", "x")
        assertEquals("high", resolveThinkingId(muse, "high"))
        assertEquals("medium", resolveThinkingId(muse, "turbo"))
        assertEquals("medium", resolveThinkingId(muse, null))
        assertEquals("high", cycleThinkingId(muse, "medium", 1))
        assertEquals("xhigh", cycleThinkingId(muse, "minimal", -1))
        assertEquals("high", cycleThinkingId(muse, "bogus", 1))
    }

    @Test fun `wire fields ride per rung`() {
        val muse = thinkingFor("muse", "x")
        assertEquals(mapOf("reasoning_effort" to "high"), muse.wireFields("high"))
        assertTrue(muse.wireFields("turbo").isEmpty())
        val ds = thinkingFor("deepseek", "deepseek-v4")
        assertEquals(mapOf("thinking" to mapOf("type" to "disabled")), ds.wireFields("off"))
        assertEquals(
            mapOf("thinking" to mapOf("type" to "enabled"), "reasoning_effort" to "max"),
            ds.wireFields("max"),
        )
        val custom = thinkingFor("custom", "x")
        assertTrue(custom.wireFields("high").isEmpty())
        assertEquals("Think carefully before answering.", custom.promptHint("high"))
        assertEquals("", custom.promptHint("medium"))
        assertEquals("", muse.promptHint("high"))
    }

    @Test fun `system prompt assembles base, hint, and reply suffix`() {
        assertEquals("", effectiveSystemPrompt(null))
        assertEquals("Reply in Japanese.", effectiveSystemPrompt(replyLanguageFor("ja")))
        assertEquals(
            "Be terse.\nThink carefully before answering.\nReply in French.",
            effectiveSystemPrompt(replyLanguageFor("fr"), "Be terse.", "Think carefully before answering."),
        )
        assertEquals("  hi  ".let { effectiveSystemPrompt(null, "  hi  ") }, "hi")
    }
}
