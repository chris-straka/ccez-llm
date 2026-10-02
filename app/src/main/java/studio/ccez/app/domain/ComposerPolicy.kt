package studio.ccez.app.domain

/**
 * Phone composer discipline (Tauri `PromptEditorOptions.enterSubmits =
 * false` + the `.app[data-android] .prompt` one-geometry rules).
 *
 * - Enter is a carriage return, never a send; only the send button
 *   submits. The Compose field stays multi-line for exactly this.
 * - One geometry in every state: a fixed compact default that grows
 *   only with content lines — fresh, focused, first character, and
 *   emptied-after-send all share the same single-line size.
 */
const val COMPOSER_MIN_LINES = 1
const val COMPOSER_MAX_LINES = 6

/** False on phones: the Enter key inserts a newline, never sends. */
fun composerEnterSubmits(): Boolean = false

/**
 * Composer selection dock (Tauri ann-dock parity): the message's
 * Annotate/Speak/Inspect ride thumb-reachable in the prompt while
 * selected text stands. Copy stays menu-only, so it is not docked.
 */
fun showComposerSelectionActions(selection: String): Boolean = selection.isNotBlank()

/**
 * Visible line span of a draft, clamped to the composer window:
 * empty and single-line drafts hold the compact default; text lines
 * grow it up to the cap, then the field scrolls.
 */
fun composerLineSpan(draft: String): Int {
    val lines = if (draft.isEmpty()) 1 else draft.split('\n').size
    return lines.coerceIn(COMPOSER_MIN_LINES, COMPOSER_MAX_LINES)
}

/**
 * Composer jump button (Tauri `points.length > 3` wp-jump parity): the
 * button lives in the prompt's tool row and appears only once the
 * thread is long enough to warrant quick navigation — never as
 * top chrome, never as a standing strip.
 */
fun showComposerJump(messageCount: Int): Boolean = waypoints(messageCount).size > 3
