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
		const page = pageSource();
		expect(page).toContain("<MessageArticle");
		expect(page).toContain("{#each viewChat.messages as msg, i (msg.id)}");
		expect(page).toContain("{@const sentRefs = annRefsFor(msg.content)}");
		expect(page).toContain("actions={{");
		expect(page).toContain("editAction: msgEditAction,");
		expect(page).toContain("ma: {");
		// The page keeps the in-place edit functions (cross as actions).
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
});
