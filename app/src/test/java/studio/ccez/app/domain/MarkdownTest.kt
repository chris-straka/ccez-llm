package studio.ccez.app.domain

import org.junit.Assert.*
import org.junit.Test

class MarkdownTest {
    private fun parse(src: String): List<MdBlock> = parseMessageMarkdown(src).first

    @Test fun `paragraphs carry emphasis`() {
        val blocks = parse("Hello **bold** and *em* with `code` and ~~gone~~.")
        val para = blocks.single() as MdBlock.Para
        assertTrue(para.inlines.any { it is MdInline.Strong })
        assertTrue(para.inlines.any { it is MdInline.Em })
        assertTrue(para.inlines.any { it is MdInline.Code })
        assertTrue(para.inlines.any { it is MdInline.Strike })
    }

    @Test fun `links parse with nested emphasis`() {
        val blocks = parse("See [**docs**](https://x.test/y) now.")
        val para = blocks.single() as MdBlock.Para
        val link = para.inlines.filterIsInstance<MdInline.Link>().single()
        assertEquals("https://x.test/y", link.url)
        assertTrue(link.label.any { it is MdInline.Strong })
    }

    @Test fun `headings fences quotes lists`() {
        val blocks = parse("# Title\n\n```kt\nval x = 1\n```\n\n> quoted **line**\n\n- a\n- b\n\n3. c\n4. d")
        assertTrue(blocks[0] is MdBlock.Heading)
        assertEquals(1, (blocks[0] as MdBlock.Heading).level)
        val code = blocks[1] as MdBlock.Code
        assertEquals("kt", code.lang)
        assertEquals("val x = 1", code.code)
        assertTrue(blocks[2] is MdBlock.Quote)
        val bullets = blocks[3] as MdBlock.Bullets
        assertEquals(2, bullets.items.size)
        val numbered = blocks[4] as MdBlock.Numbered
        assertEquals(3, numbered.start)
    }

    @Test fun `tables and rules`() {
        val blocks = parse("| a | b |\n|---|---|\n| 1 | 2 |")
        val table = blocks.single() as MdBlock.Table
        assertEquals(listOf("a", "b"), table.headers)
        assertEquals(listOf(listOf("1", "2")), table.rows)
        assertTrue(parse("---").single() is MdBlock.Hr)
    }

    @Test fun `math placeholders become math nodes`() {
        val (blocks, maths) = parseMessageMarkdown("Solve:\n\n\$\$x^2\$\$\n\nand \$y\$ inline.")
        assertTrue(maths.isNotEmpty())
        assertTrue(blocks.any { it is MdBlock.Math })
        assertTrue(blocks.filterIsInstance<MdBlock.Para>().any { p -> p.inlines.any { it is MdInline.Math } })
    }

    @Test fun `lone latex fence becomes display math`() {
        val blocks = parse("Work:\n\n```latex\n\\frac{a}{b}\n```\ndone")
        assertTrue(blocks.none { it is MdBlock.Code })
        val math = blocks.filterIsInstance<MdBlock.Math>().single()
        assertEquals("\\frac{a}{b}", math.tex)
    }

    @Test fun `copy text keeps code and math source`() {
        val (blocks, _) = parseMessageMarkdown("```py\nprint(1)\n```\n\n\$\$x\$\$")
        val text = blocksToText(blocks)
        assertTrue(text.contains("print(1)"))
        assertTrue(text.contains("\$\$x\$\$"))
    }
}
