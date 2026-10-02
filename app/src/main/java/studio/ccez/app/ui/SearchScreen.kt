package studio.ccez.app.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import studio.ccez.app.domain.SearchDoc
import studio.ccez.app.domain.querySearch

/** Global search across chats and annotation drafts (chatSearch.ts parity). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchScreen(vm: ChatViewModel, onBack: () -> Unit) {
    val state by vm.state.collectAsState()
    var query by remember { mutableStateOf("") }
    val docs = remember(state, vm.annotations.collectAsState().value) { vm.searchDocs() }
    val hits = remember(docs, query) { if (query.isBlank()) emptyList() else querySearch(docs, query) }
    Scaffold(topBar = {
        TopAppBar(
            title = { Text("Search") },
            navigationIcon = { TextButton(onClick = onBack) { Text("Back") } },
        )
    }) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().padding(16.dp)) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                placeholder = { Text("Search chats and notes…") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            LazyColumn(Modifier.fillMaxSize()) {
                items(hits, key = { it.doc.chatId + (it.doc.msgId ?: "") + it.doc.kind.name }) { hit ->
                    Card(onClick = { jumpToHit(vm, state, hit.doc, onBack) }, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                        Column(Modifier.padding(12.dp)) {
                            Text(
                                when (hit.doc.kind) {
                                    SearchDoc.Kind.ANNOTATION -> "Note"
                                    SearchDoc.Kind.MESSAGE -> "Message"
                                    SearchDoc.Kind.CHAT -> "Chat"
                                },
                                style = MaterialTheme.typography.labelLarge,
                            )
                            Text(hit.snippet, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            }
        }
    }
}

private fun jumpToHit(
    vm: ChatViewModel,
    state: studio.ccez.app.domain.ChatState,
    doc: SearchDoc,
    onBack: () -> Unit,
) {
    val chat = state.chats.find { it.id.value == doc.chatId } ?: return
    val index = doc.msgId?.let { id -> chat.messages.indexOfFirst { it.id.value == id } } ?: 0
    onBack()
    vm.jumpToChat(chat.id, index.coerceAtLeast(0))
}

