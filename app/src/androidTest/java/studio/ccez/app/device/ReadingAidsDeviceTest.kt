package studio.ccez.app.device

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import studio.ccez.app.domain.FuriganaEngine
import studio.ccez.app.domain.pinyinSegments

/**
 * On-device reading-aid checks against platform ICU (pinyin) and the
 * bundled Kuromoji dictionary (furigana). Deterministic: ICU transliteration
 * data and the pinned IPADIC dictionary don't change under the app.
 */
@RunWith(AndroidJUnit4::class)
class ReadingAidsDeviceTest {
    @Test fun icu_pinyin_marks_tones() {
        val reader = IcuPinyinReader()
        assertEquals("zhōng", reader.reading('中'))
        assertEquals("wén", reader.reading('文'))
        assertEquals("běi", reader.reading('北'))
        assertNull(reader.reading('a'))
    }

    @Test fun pinyin_segments_align_per_character() {
        val segs = pinyinSegments("中文！", IcuPinyinReader())
        assertEquals(3, segs.size)
        assertEquals("zhōng", segs[0].reading)
        assertNull(segs[2].reading)
    }

    @Test fun kuromoji_furigana_on_device() {
        val segs = FuriganaEngine().segments("日本語")
        assertTrue(segs.any { it.reading != null })
    }
}
