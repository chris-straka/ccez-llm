package studio.ccez.app.domain

/** One row of the touch-gestures sheet (Tauri touchShortcuts parity, A-Z). */
data class TouchGesture(val name: String, val gesture: String)

/** Phone gesture table, alphabetical by name like the Tauri modal. */
/**
 * Touch gestures with a working native implementation behind each row.
 * Same rows as the desktop table; only the fine print differs where
 * the native routing does (edge swipes, sideways folds), because every
 * row here must fire on a real device.
 */
fun touchGestures(): List<TouchGesture> = listOf(
    TouchGesture("Annotate", "Select text · Annotate"),
    TouchGesture("Bottom of chat", "Two-finger swipe down"),
    TouchGesture("Chat switcher", "Two-finger hold · double-tap background"),
    TouchGesture("Chats list", "Swipe right from the left edge · two-finger swipe right"),
    TouchGesture("Copy selection", "Hold the highlight 3.3s · Copy leads the menu"),
    TouchGesture("Delete a message", "Three-finger tap"),
    TouchGesture("Delete every chat", "Three-finger hold"),
    TouchGesture("Fold a message", "Swipe a message sideways"),
    TouchGesture("Inspect character", "Select one Han character · Inspect"),
    TouchGesture("Keep an annotation while scrolling", "Scroll freely · only tap-away cancels"),
    TouchGesture("Message buttons", "Tap a message · double-tap jumps to its end"),
    TouchGesture("Message end", "Double two-finger tap"),
    TouchGesture("Move the selection menu", "Drag it"),
    TouchGesture("Newer / older chat", "Three-finger swipe right / left"),
    TouchGesture("Settings", "Swipe left off messages · chats list button · two-finger swipe left"),
    TouchGesture("Speak selection", "Select text · Speak"),
    TouchGesture("Top of chat", "Two-finger swipe up"),
    TouchGesture("fold chat msg", "Swipe a message sideways"),
).sortedBy { it.name.lowercase() }

/** Cardinal swipe direction (screen coordinates: down is +y). */
enum class SwipeDir { UP, DOWN, LEFT, RIGHT }

/**
 * Combined multi-finger swipe: the fingers must travel together (every
 * vector agrees with their sum) past the minimum. Pinches and holds
 * cancel out to ~zero and route nothing. Pure for unit tests.
 */
fun combinedSwipe(vecs: List<androidx.compose.ui.geometry.Offset>, minPx: Float): SwipeDir? {
    if (vecs.size < 2) return null
    val sum = vecs.reduce { a, b -> a + b }
    if (sum.getDistance() < minPx) return null
    if (vecs.any { it.x * sum.x + it.y * sum.y < 0 }) return null
    return swipeDirection(sum.x, sum.y, 0f)
}

/**
 * Dominant-axis swipe classifier; null for taps and short or diagonal
 * strokes. Pure so the multitouch detector stays unit-testable (adb
 * cannot inject multitouch).
 */
fun swipeDirection(dx: Float, dy: Float, minPx: Float): SwipeDir? {
    val ax = kotlin.math.abs(dx)
    val ay = kotlin.math.abs(dy)
    if (ax < minPx && ay < minPx) return null
    return if (ax > ay) {
        if (dx > 0) SwipeDir.RIGHT else SwipeDir.LEFT
    } else if (ay > ax) {
        if (dy > 0) SwipeDir.DOWN else SwipeDir.UP
    } else {
        null
    }
}

/** One tap in a consecutive-tap run (double/triple/quadruple). */
data class TapSequence(val count: Int, val at: Long, val x: Float, val y: Float)

/**
 * Fold a tap into its sequence (Tauri nextTapCount parity): taps within
 * [windowMs] and [maxDist] of the last increment the count (cycling back
 * to one after four); anything else restarts at one.
 */
fun nextTapCount(
    prev: TapSequence?,
    at: Long,
    x: Float,
    y: Float,
    windowMs: Long = 400,
    maxDist: Float = 32f,
): TapSequence {
    if (prev != null && at - prev.at < windowMs &&
        kotlin.math.hypot((x - prev.x).toDouble(), (y - prev.y).toDouble()) < maxDist
    ) {
        return TapSequence(if (prev.count >= 4) 1 else prev.count + 1, at, x, y)
    }
    return TapSequence(1, at, x, y)
}

/** Edge panel a swipe summons (Tauri EdgePanel parity). */
enum class EdgePanel { CHATS, SETTINGS }

/**
 * Mid-screen swipe target (Tauri contentSwipeTarget parity): a
 * mostly-horizontal stroke of at least [minDistance] px opens chats
 * (right) or settings (left). Short strokes and vertical drift never
 * qualify, so message scrolling keeps its gestures.
 */
fun contentSwipeTarget(
    startX: Float,
    startY: Float,
    endX: Float,
    endY: Float,
    minDistance: Float = 64f,
): EdgePanel? {
    val dx = endX - startX
    val dy = endY - startY
    if (kotlin.math.abs(dx) < minDistance || kotlin.math.abs(dy) > kotlin.math.abs(dx)) return null
    return if (dx > 0) EdgePanel.CHATS else EdgePanel.SETTINGS
}

/** Masked display for a stored key: bullets plus the last 4 characters. */
fun maskKey(key: String): String {
    val trimmed = key.trim()
    if (trimmed.isEmpty()) return ""
    return if (trimmed.length <= 8) "••••" else "••••" + trimmed.takeLast(4)
}
