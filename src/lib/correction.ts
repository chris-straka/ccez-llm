/**
 * Correction mode (language chats): when the per-chat toggle is on,
 * the system prompt asks the model to append a ```correction fenced
 * block holding the corrected user text. The block hides from the
 * assistant body (see render.ts) and the user's message shows a word
 * diff under it instead. Pure: parse, tokenize, diff, escape.
 */

import { annRefsFor } from "./annotation-block";

/** Info string of the correction fence (matched case-insensitively). */
export const CORRECTION_FENCE = "correction";

/**
 * Split the ```correction block out of model output. Closed fences
 * leave the body; an unclosed fence (mid-stream) hides the rest like
 * thoughts do, and the partial text still diffs. Multiple blocks join
 * (same shape as extractThoughts). Null when no fence is present.
 */
export function extractCorrection(markdown: string): {
	correction: string | null;
	body: string;
} {
	const open = /```[ \t]*correction[ \t]*\r?\n?/gi;
	const opens = [...markdown.matchAll(open)];
	if (opens.length === 0) return { correction: null, body: markdown };
	const corrections: string[] = [];
	let body = "";
	let at = 0;
	for (const m of opens) {
		const start = m.index ?? 0;
		const inner = start + m[0].length;
		const close = markdown.indexOf("```", inner);
		const end = close === -1 ? markdown.length : close;
		const text = markdown.slice(inner, end).trim();
		if (text) corrections.push(text);
		body += markdown.slice(at, start);
		at = close === -1 ? markdown.length : close + 3;
	}
	body += markdown.slice(at);
	return {
		correction: corrections.length > 0 ? corrections.join("\n\n") : null,
		body: body.trim()
	};
}

/** True when a correction block should ride the system prompt: the
 * per-chat toggle is on AND a reply language is set (the toggle hides
 * without one, so an orphaned flag must not summon stray blocks). */
export function correctionPromptOn(
	correction: boolean | undefined,
	replyLang: string | null
): boolean {
	return correction === true && replyLang !== null;
}

/** One diff run: unchanged, deleted (user's), or inserted (model's). */
export type CorrectionOp =
	| { type: "same"; text: string }
	| { type: "del"; text: string }
	| { type: "ins"; text: string };

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * Word tokens for Latin scripts (each carrying its trailing spaces,
 * so a del/ins substitution pair rejoins readable — never "legrand"),
 * single characters for CJK (neither spaces nor word runs exist
 * there). Ops rejoin to the exact input.
 */
export function correctionTokens(text: string): string[] {
	const tokens: string[] = [];
	let word = "";
	let spaces = "";
	const flushWord = (): void => {
		if (word) tokens.push(word);
		word = "";
	};
	for (const ch of text) {
		if (CJK.test(ch)) {
			flushWord();
			if (spaces) {
				tokens.push(spaces);
				spaces = "";
			}
			tokens.push(ch);
			continue;
		}
		if (/\s/.test(ch)) {
			// Trailing spaces ride the word ahead (see above);
			// leading/standalone spaces keep their own run.
			if (word) word += ch;
			else spaces += ch;
			continue;
		}
		// A word that already carries trailing spaces is done: the
		// new character starts the next word.
		if (word && /\s$/.test(word)) flushWord();
		if (spaces) {
			tokens.push(spaces);
			spaces = "";
		}
		word += ch;
	}
	flushWord();
	if (spaces) tokens.push(spaces);
	return tokens;
}

/**
 * Minimal token diff (LCS over the token rows; correction texts are
 * sentence-sized). Adjacent same-type runs merge, so the render walks
 * runs, not tokens.
 */
export function diffCorrection(before: string, after: string): CorrectionOp[] {
	const a = correctionTokens(before);
	const b = correctionTokens(after);
	const n = a.length;
	const m = b.length;
	const lcs: number[][] = Array.from({ length: n + 1 }, () =>
		new Array<number>(m + 1).fill(0)
	);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			lcs[i]![j] =
				a[i] === b[j]
					? (lcs[i + 1]![j + 1] ?? 0) + 1
					: Math.max(lcs[i + 1]![j] ?? 0, lcs[i]![j + 1] ?? 0);
		}
	}
	const ops: CorrectionOp[] = [];
	let i = 0;
	let j = 0;
	const push = (op: CorrectionOp): void => {
		const prev = ops[ops.length - 1];
		if (prev && prev.type === op.type) prev.text += op.text;
		else ops.push(op);
	};
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			push({ type: "same", text: a[i]! });
			i++;
			j++;
		} else if ((lcs[i + 1]![j] ?? 0) >= (lcs[i]![j + 1] ?? 0)) {
			push({ type: "del", text: a[i]! });
			i++;
		} else {
			push({ type: "ins", text: b[j]! });
			j++;
		}
	}
	while (i < n) {
		push({ type: "del", text: a[i]! });
		i++;
	}
	while (j < m) {
		push({ type: "ins", text: b[j]! });
		j++;
	}
	return ops;
}

/** Escape for diff HTML (the render carries it raw via {@html}). */
export function escapeCorrection(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * Diff HTML for under a user message, or null when there is nothing to
 * show: no following assistant text, no correction block, an empty
 * user text (refs-only), or a correction identical to it. Diffs
 * against the display text (baked annotation blocks excluded, same as
 * what the user sees). Deleted runs strike, inserted runs underline.
 */
export function correctionHtmlFor(
	userContent: string,
	assistantContent: string | null
): string | null {
	if (!assistantContent) return null;
	const { correction } = extractCorrection(assistantContent);
	if (!correction) return null;
	const userText = (annRefsFor(userContent)?.text ?? userContent).trim();
	if (!userText) return null;
	if (correction.trim() === userText) return null;
	const ops = diffCorrection(userText, correction.trim());
	if (!ops.some((op) => op.type !== "same")) return null;
	return ops
		.map((op) => {
			const text = escapeCorrection(op.text);
			if (op.type === "del") return `<span class="corr-del">${text}</span>`;
			if (op.type === "ins") return `<span class="corr-ins">${text}</span>`;
			return text;
		})
		.join("");
}
