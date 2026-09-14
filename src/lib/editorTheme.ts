/**
 * Composer theme and language support (editor slice, REFACTOR §7).
 *
 * Verbatim move out of `editor.ts`: the lazy language descriptions
 * and the `appTheme` CodeMirror theme object.
 */
import { EditorView } from "@codemirror/view";
import { LanguageDescription } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { cpp } from "@codemirror/lang-cpp";

export const codeLanguages = [
	LanguageDescription.of({
		name: "javascript",
		alias: ["js", "jsx", "ts", "tsx", "mjs", "cjs"],
		load: () => Promise.resolve(javascript())
	}),
	LanguageDescription.of({
		name: "python",
		alias: ["py", "pyw", "python"],
		load: () => Promise.resolve(python())
	}),
	LanguageDescription.of({
		name: "rust",
		alias: ["rs"],
		load: () => Promise.resolve(rust())
	}),
	LanguageDescription.of({
		name: "cpp",
		alias: ["c", "h", "cc", "cpp", "cxx", "hpp", "c++"],
		load: () => Promise.resolve(cpp())
	})
];

export const appTheme = EditorView.theme({
	"&": { fontSize: "0.95rem" },
	".cm-content": { fontFamily: "inherit", padding: "0.6rem 0" },
	// The prompt grows with the draft, then stops at ~8 lines and scrolls
	// inside instead of eating the messages list. overflow-y must ride
	// along: capped without it, long drafts clip with no way to reach
	// the hidden lines.
	".cm-scroller": { maxHeight: "12rem", overflowY: "auto" },
	".cm-focused": { outline: "none" },
	// Grey shade, never a code block: the tag carries no background or
	// border of its own, just muted text (Muse Code style).
	".cm-paste-marker": {
		display: "inline-block",
		fontSize: "0.78rem",
		color: "#6e6e73",
		cursor: "pointer"
	},
	// Fence bars echo the message code-head: label left, icon buttons
	// right. Only the two bar lines are widgets — body rows stay real
	// text so the caret and IME never sit on a replacement.
	".cm-fence-bar": {
		display: "flex",
		alignItems: "center",
		gap: "0.5rem",
		backgroundColor: "#f1f1f4",
		border: "1px solid #e5e5ea",
		borderRadius: "8px",
		padding: "0.15rem 0.5rem",
		fontSize: "0.75rem"
	},
	".cm-fence-lang": {
		fontFamily: "'Fira Code', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
		fontWeight: "600",
		color: "#6e6e73"
	},
	".cm-fence-btn": {
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		marginLeft: "auto",
		background: "none",
		border: "none",
		padding: "2px",
		color: "inherit",
		cursor: "pointer",
		borderRadius: "6px"
	},
	".cm-fence-btn + .cm-fence-btn": { marginLeft: "0" },
	".cm-fence-btn svg": { height: "0.95rem", width: "0.95rem" },
	".cm-fence-btn:disabled": { opacity: "0.35", cursor: "default" },
	".cm-fence-btn.folded svg": { transform: "rotate(180deg)" },
	".cm-fence-btn.copied": { color: "#1f7a4d" },
	".cm-fence-end": {
		height: "0.45rem",
		borderBottom: "1px solid #c7c7cc"
	},
	".cm-fence-collapsed": {
		display: "block",
		width: "100%",
		textAlign: "left",
		background: "none",
		border: "none",
		padding: "0.2rem 0",
		fontSize: "0.8rem",
		color: "#6e6e73",
		cursor: "pointer"
	},
	// Insert-mode caret (light scheme; dark lives in +page.svelte global
	// CSS because @media inside a CM theme object is unreliable).
	".cm-cursor": { borderLeftColor: "#1c1c1e" }
});
