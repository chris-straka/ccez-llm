package studio.ccez.app.domain

import org.junit.Assert.*
import org.junit.Test

class WordSpeakTest {
    @Test fun `words expand to the maximal run`() {
        assertEquals("hello", extractWordAt("hello world", 1))
        assertEquals("world", extractWordAt("hello world", 8))
        assertEquals("", extractWordAt("hello world", 5))
        assertEquals("", extractWordAt("", 0))
        assertEquals("", extractWordAt("hi", -1))
        assertEquals("", extractWordAt("hi", 2))
    }

    @Test fun `cjk punctuation breaks words`() {
        assertEquals("你好", extractWordAt("你好，世界", 1))
        assertEquals("世界", extractWordAt("你好，世界", 3))
        assertEquals("", extractWordAt("你好，世界", 2))
        assertEquals("テスト", extractWordAt("テスト・です", 2))
    }

    @Test fun `locales resolve by script in web priority`() {
        assertEquals("ar-SA", ttsLangFor("مرحبا"))
        assertEquals("ja-JP", ttsLangFor("こんにちは"))
        assertEquals("ko-KR", ttsLangFor("안녕하세요"))
        assertEquals("zh-CN", ttsLangFor("你好"))
        assertEquals("ru-RU", ttsLangFor("привет"))
        assertEquals("el-GR", ttsLangFor("γεια"))
        assertEquals("he-IL", ttsLangFor("שלום"))
        assertEquals("th-TH", ttsLangFor("สวัสดี"))
        assertEquals("hi-IN", ttsLangFor("नमस्ते"))
        assertEquals("hy-AM", ttsLangFor("բարեւ"))
        assertEquals("ka-GE", ttsLangFor("გამარჯობა"))
    }

    @Test fun `kana plus kanji mixes read japanese`() {
        assertEquals("ja-JP", ttsLangFor("日本語です"))
        assertEquals("zh-CN", ttsLangFor("这是中文"))
    }

    @Test fun `latin words use the fallback`() {
        assertEquals("en-US", ttsLangFor("hello"))
        assertEquals("fr-FR", ttsLangFor("bonjour", "fr-FR"))
        assertEquals("en-US", ttsLangFor("123 ..."))
    }

    @Test fun `toned pinyin is unambiguously mandarin`() {
        assertTrue(hasPinyinTones("nǐ hǎo"))
        assertTrue(hasPinyinTones("LǗ"))
        assertFalse(hasPinyinTones("ni hao"))
        assertFalse(hasPinyinTones("hello"))
    }
}
