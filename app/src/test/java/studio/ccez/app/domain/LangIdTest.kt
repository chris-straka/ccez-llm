package studio.ccez.app.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LangIdTest {
    @Test fun `scripts resolve without statistics`() {
        assertEquals("ja-JP", identifyLangOffline("日本語を勉強しています"))
        assertEquals("zh-CN", identifyLangOffline("我正在学习中文"))
        assertNull(identifyLangOffline("hi"))
    }

    @Test fun `conversational sentences identify`() {
        assertEquals(
            "en-US",
            identifyLangOffline("Great picks these are all very natural German constructions indeed"),
        )
        assertEquals(
            "de-DE",
            identifyLangOffline("Der Hund und die Katze sind nicht von hier mit den anderen aus der Stadt"),
        )
        assertEquals(
            "fr-FR",
            identifyLangOffline("Je ne sais pas où est la gare parce que je suis perdu ici"),
        )
    }

    @Test fun `short samples stay null`() {
        assertEquals(null, identifyLangOffline(""))
        assertEquals(null, identifyLangOffline("hi there"))
        assertEquals(
            null,
            identifyLangOffline("lorem ipsum dolor sit amet consectetur adipiscing"),
        )
    }

    @Test fun `short scorer reads german quotes`() {
        assertEquals("de-DE", identifyLangShort("bis zu einer erstaunlichen Vielfalt an Brotsorten"))
        assertEquals("de-DE", identifyLangShort("Weihnachtsmärkte"))
        assertEquals("de-DE", identifyLangShort("der Hund"))
        assertEquals("de-DE", identifyLangShort("für dich"))
        assertEquals(null, identifyLangShort("tief geformt"))
    }

    @Test fun `short scorer reads english french and neighbors`() {
        assertEquals(
            "en-US",
            identifyLangShort("Great picks — these are all very natural German constructions"),
        )
        assertEquals("en-US", identifyLangShort("the cat"))
        assertEquals("fr-FR", identifyLangShort("L'histoire allemande fut façonnée par une série"))
        assertEquals("fr-FR", identifyLangShort("où est la gare"))
        assertEquals("es-ES", identifyLangShort("¿Dónde está la biblioteca"))
        assertEquals("it-IT", identifyLangShort("è un bel giorno"))
        assertEquals("pt-PT", identifyLangShort("não sei onde é"))
        assertEquals("nl-NL", identifyLangShort("ik zie je morgen"))
    }

    @Test fun `short scorer stays null on scoreless or contested fragments`() {
        assertEquals(null, identifyLangShort(""))
        assertEquals(null, identifyLangShort("qwerty asdf"))
        assertEquals(null, identifyLangShort("miteinander"))
        assertEquals(null, identifyLangShort("tief = deep / deeply"))
        assertEquals(null, identifyLangShort("connects, joins, combines"))
        assertEquals(null, identifyLangShort("deeply shaped / profoundly shaped"))
    }

    @Test fun `short scorer defaults french diacritics without exclusive rivals`() {
        // Bare é ties three ways with no leader — the tiebreak claims it.
        assertEquals("fr-FR", identifyLangShort("café"))
        assertEquals("fr-FR", identifyLangShort("révise"))
        assertEquals("fr-FR", identifyLangShort("essuyât"))
        assertEquals("fr-FR", identifyLangShort("façonnée"))
        // Exclusive evidence vetoes the default.
        assertEquals("es-ES", identifyLangShort("niño"))
        assertEquals(null, identifyLangShort("coração"))
        assertEquals("pt-PT", identifyLangShort("não"))
        assertEquals("de-DE", identifyLangShort("Straße"))
        assertEquals(null, identifyLangShort("the café"))
        // Italian keeps its own; bare à-only never triggers.
        assertEquals("it-IT", identifyLangShort("è"))
        assertEquals("it-IT", identifyLangShort("più"))
        assertEquals("it-IT", identifyLangShort("così"))
        assertEquals(null, identifyLangShort("città"))
    }

    @Test fun `exclusive stop word decides a contested fragment`() {
        assertEquals("fr-FR", identifyLangShort("avec un tiret"))
    }

    @Test fun `quote resolver falls back without ever nulling`() {
        assertEquals("de-DE", quoteLangFor("Weihnachtsmärkte", "en-US"))
        assertEquals("en-US", quoteLangFor("qwerty asdf", "en-US"))
        assertEquals("ja-JP", quoteLangFor("日本語を勉強しています", "en-US"))
        assertEquals("zh-CN", quoteLangFor("日本語", "en-US"))
    }
}
