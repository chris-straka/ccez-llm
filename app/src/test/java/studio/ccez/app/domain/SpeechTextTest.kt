package studio.ccez.app.domain

import org.junit.Assert.assertEquals
import org.junit.Test

/** voice.ts behavior pins, ported case for case. */
class SpeechTextTest {
    @Test fun `splits on Latin and CJK terminators`() {
        assertEquals(
            listOf("Hello world.", "How are you?", "Fine!"),
            splitSentences("Hello world. How are you? Fine!"),
        )
        assertEquals(
            listOf("你好世界。", "今天好吗？", "很好！"),
            splitSentences("你好世界。今天好吗？很好！"),
        )
    }

    @Test fun `handles single sentences and empties`() {
        assertEquals(listOf("Bonjour"), splitSentences("Bonjour"))
        assertEquals(emptyList<String>(), splitSentences("   "))
        assertEquals(emptyList<String>(), splitSentences(""))
    }

    @Test fun `keeps halves on separate lines in their own voices`() {
        assertEquals(
            listOf("Hello world", "こんにちは世界"),
            splitSentences("Hello world\nこんにちは世界"),
        )
        assertEquals(
            listOf("First.", "Second line"),
            splitSentences("First.\n\nSecond line"),
        )
    }

    @Test fun `drops code fences and markdown noise`() {
        val text = speechText(
            "# Title\n\nHello **world**.\n\n```ts\nconst x = 1;\n```\n\n[Pasted an image]",
        )
        assert(text.contains("Title"))
        assert(text.contains("Hello world."))
        assert(!text.contains("const x"))
        assert(!text.contains("```"))
        assert(!text.contains("[Pasted an image]"))
    }

    @Test fun `names pasted content instead of reading markers`() {
        assertEquals("pasted content", speechText("[Pasted 250 chars]"))
        assertEquals("look pasted image", speechText("look [Pasted image]"))
    }

    @Test fun `kana and other scripts decide for themselves`() {
        assertEquals("ja-JP", sentenceSpeechLang("漢字を読む", "zh-CN"))
        assertEquals("ja-JP", sentenceSpeechLang("自然が好き", "zh-CN"))
        assertEquals("ja-JP", sentenceSpeechLang("Bonjour", "ja-JP"))
    }

    @Test fun `keeps complete han-only sentences chinese`() {
        assertEquals("zh-CN", sentenceSpeechLang("我是学生。", "ja-JP"))
        assertEquals("zh-CN", sentenceSpeechLang("你好世界！", "ja-JP"))
    }

    @Test fun `hands mid-highlight fragments back to the surrounding voice`() {
        assertEquals("ja-JP", sentenceSpeechLang("自", "ja-JP"))
        assertEquals("ja-JP", sentenceSpeechLang("自然", "ja-JP"))
        assertEquals("zh-CN", sentenceSpeechLang("自", "zh-CN"))
    }

    @Test fun `keeps single-script sentences whole`() {
        assertEquals(listOf("Hello world."), splitScriptRuns("Hello world."))
        assertEquals(listOf("日本語です。"), splitScriptRuns("日本語です。"))
        assertEquals(listOf("..."), splitScriptRuns("..."))
    }

    @Test fun `breaks on script change gluing spaces and digits`() {
        assertEquals(listOf("Hello", "世界"), splitScriptRuns("Hello世界"))
        assertEquals(listOf("2024年", "Report"), splitScriptRuns("2024年 Report"))
        assertEquals(listOf("a", "ب", "c"), splitScriptRuns("aبc"))
    }

    @Test fun `shares one run for kana and Han`() {
        assertEquals(listOf("漢字ひらがな"), splitScriptRuns("漢字ひらがな"))
    }

    @Test fun `resolves a voice locale per sentence`() {
        val langFor = { s: String -> ttsLangFor(s, "en-US") }
        assertEquals(
            listOf(
                SpeechSegment("Hello world.", "en-US"),
                SpeechSegment("你好！", "zh-CN"),
                SpeechSegment("こんにちは！", "ja-JP"),
            ),
            splitSpeechSegments("Hello world. 你好！こんにちは！", langFor),
        )
    }

    @Test fun `returns no segments for blank text`() {
        assertEquals(emptyList<SpeechSegment>(), splitSpeechSegments("   ") { s -> ttsLangFor(s, "en-US") })
    }

    @Test fun `splits same-sentence script runs with no break between halves`() {
        val langFor = { s: String -> ttsLangFor(s, "en-US") }
        assertEquals(
            listOf(SpeechSegment("Hello", "en-US"), SpeechSegment("世界。", "zh-CN")),
            splitSpeechSegments("Hello世界。", langFor),
        )
    }

    @Test fun `keeps same-locale runs one utterance with exact text`() {
        val langFor = { s: String -> ttsLangFor(s, "en-US") }
        assertEquals(
            listOf(SpeechSegment("Hello", "en-US"), SpeechSegment("世界", "zh-CN")),
            splitSpeechSegments("Hello世界", langFor),
        )
    }

    @Test fun `gloss halves split at top level equals only`() {
        assertEquals(
            Pair("miteinander", "with each other"),
            splitGlossHalves("miteinander = with each other"),
        )
        assertEquals(Pair("tief", "deep / deeply"), splitGlossHalves("tief = deep / deeply"))
        assertEquals(null, splitGlossHalves("a == b"))
        assertEquals(null, splitGlossHalves("a => b"))
        assertEquals(null, splitGlossHalves("x = 2"))
        assertEquals(null, splitGlossHalves("no equals here"))
    }

    @Test fun `gloss halves read in different voices, same-voice lines whole`() {
        val halves = { s: String -> if (s == "miteinander") "de-DE" else "en-US" }
        assertEquals(
            listOf(
                SpeechSegment("miteinander", "de-DE"),
                SpeechSegment("with each other", "en-US"),
            ),
            splitSpeechSegments("miteinander = with each other", halves),
        )
        assertEquals(
            listOf(SpeechSegment("miteinander = with each other", "de-DE")),
            splitSpeechSegments("miteinander = with each other") { "de-DE" },
        )
    }

    @Test fun `sentence resolver reads terms in seed and translations in gloss voice`() {
        val langFor = sentenceLangsFor(
            "Das Wetter ist heute sehr schön und warm. miteinander = with each other",
            "de-DE",
            "en-US",
        )
        assertEquals("de-DE", langFor("miteinander"))
        assertEquals("en-US", langFor("with each other"))
        val scoreless = sentenceLangsFor("verbindet = connects, joins, combines", "de-DE", "en-US")
        assertEquals("de-DE", scoreless("verbindet"))
        assertEquals("en-US", scoreless("connects, joins, combines"))
    }

    @Test fun `dictation maps engine failures to display hints`() {
        assertEquals(
            "Speech recognition isn't available on this device.",
            dictationHint("speech recognition unavailable on this device"),
        )
        assertEquals(
            "Mic permission denied — allow the microphone and try again.",
            dictationHint("dictation error: 9"),
        )
        assertEquals("Didn't catch anything — try again.", dictationHint("dictation error: 7"))
        assertEquals("Dictation timed out — try again.", dictationHint("dictation error: 8"))
        assertEquals("weird engine blob", dictationHint("weird engine blob"))
    }
}
