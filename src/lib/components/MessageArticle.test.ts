import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Per-message article rows render in MessageArticle.svelte; the page
 * keeps the message lists, all row state, and every behavior behind
 * computed props and action groups. The nested usages (SentAttachments
 * ×2, SentRefs, MessageBody, MessageActions) move with the row, so
 * each child's contract still checks at both ends; the in-place editor
 * crosses as a `use:` action and mounts where the text sat.
 */
function componentSource(): string {
	return readFileSync(new URL("./MessageArticle.svelte", import.meta.url), "utf8");
}

function componentStyle(): string {
	const source = componentSource();
	const match = source.match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("MessageArticle.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

function pageSource(): string {
	return readFileSync(new URL("../../routes/+page.svelte", import.meta.url), "utf8");
}

function threadSource(): string {
	return readFileSync(new URL("./ThreadView.svelte", import.meta.url), "utf8");
}


function pageStyle(): string {
	const match = pageSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("+page.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("message article contract", () => {
	it("owns the row shell, edit box, and nested usages", () => {
		const source = componentSource();
		expect(source).toContain("export interface MessageArticleActions");
		expect(source).toContain("<article");
		expect(source).toContain('class:folded-msg={folded}');
		expect(source).toContain('class:speaking={speakingNow}');
		expect(source).toContain('data-actions-open={actionsOpen}');
		expect(source).toContain('class="msg-edit"');
		expect(source).toContain("use:actions.editAction");
		expect(source).toContain("<SentAttachments");
		expect(source).toContain("<SentRefs");
		expect(source).toContain("<MessageBody");
		expect(source).toContain("<MessageActions");
	});

	it("binds the refs pop/draft/box the page focuses", () => {
		const source = componentSource();
		expect(source).toContain("popOpen = $bindable(null)");
		expect(source).toContain("refsDraft = $bindable(");
		expect(source).toContain("refsBox = $bindable(null)");
		expect(source).toContain("bind:popOpen");
		expect(source).toContain("bind:editDraft={refsDraft}");
		expect(source).toContain("bind:editBox={refsBox}");
	});

	it("keeps lists, derivations, and behaviors paged", () => {
		const thread = threadSource();
		expect(thread).toContain("<MessageArticle");
		expect(thread).toContain("{#each messages as msg, i (msg.id)}");
		expect(thread).toContain("{@const sentRefs = annRefsFor(msg.content)}");
		expect(thread).toContain("actions={{");
		expect(thread).toContain(
			"editAction: (node: HTMLElement) => actions.editAction(node),"
		);
		expect(thread).toContain("ma: {");
		// The page keeps the in-place edit functions (cross as actions).
		const page = pageSource();
		expect(page).toContain("function blurInlineEdit");
		expect(page).toContain("function msgEditAction");
	});

	it("keeps no article selector in page style", () => {
		const css = pageStyle();
		for (const selector of [
			"article",
			".bubble",
			"msg-edit",
			"folded-msg",
			"speaking-sel"
		]) {
			expect(css, selector).not.toContain(selector);
		}
	});

	it("keeps the row surfaces scoped to the article", () => {
		const css = componentStyle();
		expect(css).toContain("article.user .bubble");
		expect(css).toContain("article.user .msg-edit");
		expect(css).toContain(".msg-edit-box :global(.ta-input)");
		expect(css).toContain("article.selected");
		expect(css).toContain(":global(main.hide-messages) article");
		expect(css).toContain(":global(article.folded-msg) + article.folded-msg");
	});

	/** Body of the exact desktop rule (never the data-android override). */
	function desktopRule(css: string, selector: string): string {
		const match = css.match(
			new RegExp(`(^|\\n)\\t${selector} \\{([^}]*)\\}`)
		);
		if (!match?.[2]) throw new Error(`${selector} has no desktop rule`);
		return match[2];
	}

	it("grows the desktop edit field to its content (no one-row clip)", () => {
		// The editor stands down from manual sizing wherever the
		// engine claims field-sizing support, so the desktop rule
		// must own the height like the composer and phone rules do —
		// without it only the first wrapped line shows.
		const css = componentStyle();
		const body = desktopRule(css, "\\.msg-edit-box :global\\(\\.ta-input\\)");
		expect(body).toContain("field-sizing: content");
	});

	it("edits inline: the box matches the message it replaces", () => {
		// No editing frame: shaded messages edit on the same wash,
		// plain ones on no background at all — only the cursor says
		// editing. Tinted ink matches too.
		const css = componentStyle();
		const body = desktopRule(css, "article\\.user \\.msg-edit");
		expect(body).toContain("background: var(--bg-wash)");
		expect(body).not.toContain("var(--bg-raised)");
		expect(body).not.toContain("1px solid");
		expect(css).toContain(
			":global(main.plain-user) article.user .msg-edit"
		);
		for (const ink of ["pink", "blue", "green", "amber", "purple"]) {
			expect(css).toContain(
				`:global(main[data-own-ink="${ink}"]) article.user .msg-edit`
			);
		}
	});
});
