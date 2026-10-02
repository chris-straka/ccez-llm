package studio.ccez.app.domain

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Office/PDF text extraction (attachExtract.ts parity, native drivers).
 *
 * PDF rides pdfbox-android; docx needs no dependency — a docx is a zip
 * whose word/document.xml holds the text runs (`w:t`), paragraphs
 * (`w:p`), and tabs. Both feed the same cap + token estimate as plain
 * text files.
 */

/** Pull visible text out of word/document.xml: runs join, paragraphs break. */
fun extractDocxText(zipBytes: ByteArray): String {
    val xml = ZipInputStream(ByteArrayInputStream(zipBytes)).use { zip ->
        var entry = zip.nextEntry
        var found: ByteArray? = null
        while (entry != null) {
            if (entry.name == "word/document.xml") {
                found = zip.readBytes()
                break
            }
            entry = zip.nextEntry
        }
        found ?: throw IllegalArgumentException("Not a docx: word/document.xml missing")
    }
    val factory = DocumentBuilderFactory.newInstance()
    // Namespace-aware: without it every localName is null and no run matches.
    factory.isNamespaceAware = true
    val doc = factory.newDocumentBuilder().parse(ByteArrayInputStream(xml))
    doc.documentElement.normalize()
    val out = StringBuilder()
    val paragraphs = doc.getElementsByTagNameNS("*", "p")
    for (i in 0 until paragraphs.length) {
        val acc = mutableListOf<String>()
        fun walk(n: org.w3c.dom.Node) {
            if (n.localName == "t") acc.add(n.textContent)
            if (n.localName == "tab") acc.add("\t")
            val children = n.childNodes
            for (k in 0 until children.length) walk(children.item(k))
        }
        walk(paragraphs.item(i))
        if (out.isNotEmpty()) out.append('\n')
        out.append(acc.joinToString(""))
    }
    return out.toString()
}

/** Minimal in-memory docx for tests: paragraphs of plain runs. */
fun makeTestDocx(paragraphs: List<String>): ByteArray {
    fun esc(s: String): String = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    val xml = """<?xml version="1.0" encoding="UTF-8"?>""" +
        """<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">""" +
        """<w:body>""" +
        paragraphs.joinToString("") { p -> "<w:p><w:r><w:t>${esc(p)}</w:t></w:r></w:p>" } +
        """</w:body></w:document>"""
    val out = ByteArrayOutputStream()
    ZipOutputStream(out).use { zip ->
        zip.putNextEntry(ZipEntry("word/document.xml"))
        zip.write(xml.toByteArray(Charsets.UTF_8))
        zip.closeEntry()
    }
    return out.toByteArray()
}
