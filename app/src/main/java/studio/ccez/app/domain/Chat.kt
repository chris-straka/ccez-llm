package studio.ccez.app.domain

import java.util.UUID

/** Opaque ids: plain strings at runtime, compiler-distinct like chat.ts. */
@JvmInline value class ChatId(val value: String)
@JvmInline value class ChatMsgId(val value: String)
@JvmInline value class ProviderId(val value: String)

fun newChatId(): ChatId = ChatId(UUID.randomUUID().toString())
fun newMsgId(): ChatMsgId = ChatMsgId(UUID.randomUUID().toString())

/** Collapsed pasted span: UTF-16 offsets into content. Display-only. */
data class PasteFold(
    val start: Int,
    val end: Int,
    val chars: Int,
    val open: Boolean = false,
)

data class Attachment(
    val id: String = UUID.randomUUID().toString(),
    val name: String,
    val mimeType: String,
    val charCount: Int = 0,
    /** "image" (downscaled JPEG data URL) or "text" (inlined file text). */
    val kind: String = "text",
    val dataUrl: String? = null,
    val text: String? = null,
    /** Estimated tokens this attachment adds to the request. */
    val tokens: Int = 0,
)

data class TokenUsage(
    val prompt: Int,
    val completion: Int,
    val total: Int,
    val reasoning: Int? = null,
)

data class ChatMsg(
    val id: ChatMsgId = newMsgId(),
    val role: Role,
    val content: String,
    val usage: TokenUsage? = null,
    val error: String? = null,
    val attachments: List<Attachment> = emptyList(),
    val pasteFolds: List<PasteFold> = emptyList(),
) {
    enum class Role { USER, ASSISTANT }
    val retryable: Boolean get() = error != null
}

/** Per-chat reply-language pill (null = off), voice override (null = follow global). */
data class Chat(
    val id: ChatId = newChatId(),
    val createdAt: Long = System.currentTimeMillis(),
    val messages: List<ChatMsg> = emptyList(),
    val replyLang: String? = null,
    val voice: Boolean? = null,
)

/** Very rough token estimate shown on attachments/composer (Tauri parity: ~4 chars/token). */
fun estimateTokens(chars: Int): Int = (chars + 3) / 4

fun attachmentTokenEstimate(a: Attachment): Int = estimateTokens(a.charCount)

/** Timestamp label for the sidebar, e.g. "Today 14:32", "Yesterday", "Sep 12". */
fun timestampLabel(createdAt: Long, now: Long = System.currentTimeMillis()): String {
    val cal = java.util.Calendar.getInstance().apply { timeInMillis = now }
    val then = java.util.Calendar.getInstance().apply { timeInMillis = createdAt }
    val sameDay = cal.get(java.util.Calendar.YEAR) == then.get(java.util.Calendar.YEAR) &&
        cal.get(java.util.Calendar.DAY_OF_YEAR) == then.get(java.util.Calendar.DAY_OF_YEAR)
    cal.add(java.util.Calendar.DAY_OF_YEAR, -1)
    val yesterday = cal.get(java.util.Calendar.YEAR) == then.get(java.util.Calendar.YEAR) &&
        cal.get(java.util.Calendar.DAY_OF_YEAR) == then.get(java.util.Calendar.DAY_OF_YEAR)
    val time = java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault()).format(java.util.Date(createdAt))
    return when {
        sameDay -> "Today $time"
        yesterday -> "Yesterday $time"
        else -> java.text.SimpleDateFormat("MMM d", java.util.Locale.getDefault()).format(java.util.Date(createdAt))
    }
}
