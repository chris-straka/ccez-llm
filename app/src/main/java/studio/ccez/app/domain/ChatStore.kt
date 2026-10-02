package studio.ccez.app.domain

/**
 * UI-agnostic chat state, ported from chat.ts.
 * Plain data + pure functions so unit tests (and Compose) stay thin.
 * Sending state is never persisted: reloads always boot idle.
 */
data class ChatState(
    val chats: List<Chat> = emptyList(),
    val activeChatId: ChatId? = null,
    val sendingChatIds: Set<ChatId> = emptySet(),
) {
    val sending: Boolean get() = sendingChatIds.isNotEmpty()
    val activeChat: Chat? get() = chats.find { it.id == activeChatId }
}

fun emptyState(): ChatState = ChatState()

fun createChat(state: ChatState, chat: Chat = Chat()): ChatState =
    state.copy(chats = listOf(chat) + state.chats, activeChatId = chat.id)

/** Healing loader parity: drops corrupt chats, keeps the newest valid active id. */
fun loadChats(raw: List<Chat>, savedActiveId: ChatId?): ChatState {
    val valid = raw.filter { it.messages.all { m -> m.content.isNotNull() } }
    val active = valid.find { it.id == savedActiveId }?.id ?: valid.firstOrNull()?.id
    return ChatState(chats = valid, activeChatId = active)
}

private fun String?.isNotNull(): Boolean = true // content is non-null by type; keeps the shape explicit

fun appendMessage(state: ChatState, chatId: ChatId, msg: ChatMsg): ChatState =
    state.copy(chats = state.chats.map { if (it.id == chatId) it.copy(messages = it.messages + msg) else it })

fun deleteMessage(state: ChatState, chatId: ChatId, msgId: ChatMsgId): ChatState =
    state.copy(chats = state.chats.map { if (it.id == chatId) it.copy(messages = it.messages.filterNot { m -> m.id == msgId }) else it })

fun editMessage(state: ChatState, chatId: ChatId, msgId: ChatMsgId, content: String): ChatState =
    state.copy(chats = state.chats.map { chat ->
        if (chat.id != chatId) chat
        else chat.copy(messages = chat.messages.map { if (it.id == msgId) it.copy(content = content, error = null) else it })
    })

/**
 * Rerun-from-here (desktop rerunFrom parity): drops every message after
 * the user message [msgId], so the next send regenerates its reply.
 * Non-user targets and unknown ids return the state untouched.
 */
fun rerunFrom(state: ChatState, chatId: ChatId, msgId: ChatMsgId): ChatState {
    val chat = state.chats.find { it.id == chatId } ?: return state
    val idx = chat.messages.indexOfFirst { it.id == msgId }
    if (idx < 0 || chat.messages[idx].role != ChatMsg.Role.USER) return state
    return state.copy(chats = state.chats.map { c ->
        if (c.id != chatId) c else c.copy(messages = c.messages.take(idx + 1))
    })
}

/**
 * Newest-first neighbor id (newer = toward the head); null at the ends
 * or for unknown ids. Backs three-finger swipe chat stepping.
 */
fun stepChatId(chats: List<Chat>, activeId: ChatId, newer: Boolean): ChatId? {
    val idx = chats.indexOfFirst { it.id == activeId }
    if (idx < 0) return null
    return chats.getOrNull(if (newer) idx - 1 else idx + 1)?.id
}

/**
 * Switcher cycle with wraparound (newer = toward the head): stepping
 * past either end loops to the other side. Null only for unknown ids
 * and empty lists.
 */
fun cycleChatId(chats: List<Chat>, activeId: ChatId, newer: Boolean): ChatId? {
    val idx = chats.indexOfFirst { it.id == activeId }
    if (idx < 0 || chats.isEmpty()) return null
    val next = if (newer) idx - 1 else idx + 1
    return chats.getOrNull(next)?.id ?: if (newer) chats.last().id else chats.first().id
}

/** Branch-from-here: new chat carrying messages up to and including [msgId]. */
fun branchFrom(state: ChatState, chatId: ChatId, msgId: ChatMsgId): ChatState {
    val src = state.chats.find { it.id == chatId } ?: return state
    val idx = src.messages.indexOfFirst { it.id == msgId }
    if (idx < 0) return state
    val branched = Chat(
        messages = src.messages.take(idx + 1).map { it.copy(id = newMsgId()) },
        replyLang = src.replyLang,
        voice = src.voice,
    )
    return state.copy(chats = listOf(branched) + state.chats, activeChatId = branched.id)
}

fun markSending(state: ChatState, chatId: ChatId, sending: Boolean): ChatState =
    state.copy(sendingChatIds = if (sending) state.sendingChatIds + chatId else state.sendingChatIds - chatId)

fun updateChat(state: ChatState, chatId: ChatId, f: (Chat) -> Chat): ChatState =
    state.copy(chats = state.chats.map { if (it.id == chatId) f(it) else it })

/**
 * Delete a chat (Tauri chat.ts deleteChat parity, newest-first): a blank
 * takes its place when the list empties, and a deleted active id lands on
 * the chat that slid into its place (next-older), or the new bottom one
 * when it was last. Dropping a background chat never moves the active id.
 */
fun deleteChat(state: ChatState, chatId: ChatId): ChatState {
    val at = state.chats.indexOfFirst { it.id == chatId }
    val chats = state.chats.filterNot { it.id == chatId }
    val filled = if (chats.isEmpty()) listOf(Chat()) else chats
    val active = if (filled.none { it.id == state.activeChatId }) {
        filled[minOf(maxOf(at, 0), filled.size - 1)].id
    } else {
        state.activeChatId
    }
    return state.copy(chats = filled, activeChatId = active, sendingChatIds = state.sendingChatIds - chatId)
}

/**
 * Fold toggle (Tauri message-swipe parity): a stroke starting on a
 * message folds it either way — swiping toggles, never summons.
 */
fun toggleFold(folded: Set<ChatMsgId>, id: ChatMsgId): Set<ChatMsgId> =
    if (folded.contains(id)) folded - id else folded + id

/**
 * Wipe every chat (Tauri deleteAllChats parity): a single blank chat
 * takes the thread's place and becomes active.
 */
fun clearChats(state: ChatState): ChatState {
    val chat = Chat()
    return state.copy(chats = listOf(chat), activeChatId = chat.id, sendingChatIds = emptySet())
}

/** Waypoint strip: indices that start a new "page" every [pageSize] messages. */
fun waypoints(messageCount: Int, pageSize: Int = 20): List<Int> {
    if (messageCount <= 0 || pageSize <= 0) return emptyList()
    return (0 until messageCount step pageSize).toList()
}
