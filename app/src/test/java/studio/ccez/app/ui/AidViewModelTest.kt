package studio.ccez.app.ui

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import studio.ccez.app.domain.ChatMsg
import studio.ccez.app.domain.ChatMsgId
import studio.ccez.app.domain.LocalAid
import studio.ccez.app.domain.PinyinReader

@OptIn(ExperimentalCoroutinesApi::class)
class AidViewModelTest {
    private val main = StandardTestDispatcher()
    private val fakePinyin = PinyinReader { c -> if (c == '中') "zhōng" else null }

    @Before fun setUp() { Dispatchers.setMain(main) }
    @After fun tearDown() { Dispatchers.resetMain() }

    @Test fun `pins toggle and convert on dispatcher`() = runTest(main) {
        val vm = ChatViewModel(pinyinReader = fakePinyin, aidDispatcher = main)
        val chat = vm.repo.newChat()
        val msg = ChatMsg(id = ChatMsgId("m1"), role = ChatMsg.Role.ASSISTANT, content = "中文好")
        vm.repo.update { s -> studio.ccez.app.domain.appendMessage(s, chat.id, msg) }

        assertTrue((vm.aidPins.value[msg.id] ?: emptySet()).isEmpty())
        vm.toggleAid(chat.id, msg, LocalAid.PINYIN)
        assertEquals(setOf(LocalAid.PINYIN), vm.aidPins.value[msg.id])
        // The conversion runs on the injected dispatcher: advance it explicitly.
        main.scheduler.advanceUntilIdle()
        val segs = vm.aidSegments.value[msg.id to setOf(LocalAid.PINYIN)]!!
        assertEquals("zhōng", segs[0].reading)
        assertEquals("中", segs[0].surface)

        vm.toggleAid(chat.id, msg, LocalAid.PINYIN)
        assertTrue((vm.aidPins.value[msg.id] ?: emptySet()).isEmpty())

        vm.toggleAid(chat.id, msg, LocalAid.PINYIN)
        vm.clearAids(msg.id)
        assertNull(vm.aidPins.value[msg.id])
        assertTrue(vm.aidSegments.value.keys.none { it.first == msg.id })
    }

    @Test fun `dictation appends heard text and reports errors`() = runTest(main) {
        val vm = ChatViewModel(dictator = studio.ccez.app.device.Dictator { "hello world" }, aidDispatcher = main)
        vm.dictate()
        main.scheduler.advanceUntilIdle()
        assertEquals("hello world", vm.draft.value)
        assertEquals(false, vm.dictating.value)
        vm.dictate()
        main.scheduler.advanceUntilIdle()
        assertEquals("hello world hello world", vm.draft.value)

        val failing = ChatViewModel(dictator = studio.ccez.app.device.Dictator { throw RuntimeException("mic busy") }, aidDispatcher = main)
        failing.dictate()
        main.scheduler.advanceUntilIdle()
        // Engine "busy" maps to the timeout hint (dictationHint parity).
        assertEquals("Dictation timed out — try again.", failing.consumeAidError())
    }

    @Test fun `ocr stages recognized text and caps at ten`() = runTest(main) {
        val vm = ChatViewModel(ocr = studio.ccez.app.device.OcrReader { "hello ocr" }, aidDispatcher = main)
        val img = studio.ccez.app.domain.Attachment(
            name = "pic.jpg", mimeType = "image/jpeg", kind = "image",
            dataUrl = "data:image/jpeg;base64,AAAA", tokens = 100,
        )
        vm.stageAttachment(img)
        assertEquals(1, vm.stagedAttachments.value.size)
        vm.ocrStagedImage(img.id)
        main.scheduler.advanceUntilIdle()
        assertEquals(2, vm.stagedAttachments.value.size)
        val text = vm.stagedAttachments.value[1]
        assertEquals("hello ocr", text.text)
        assertEquals("pic.jpg.txt", text.name)

        repeat(9) { i -> vm.stageAttachment(img.copy(id = "filler-$i")) }
        assertEquals(10, vm.stagedAttachments.value.size)
        vm.stageAttachment(img.copy(id = "overflow"))
        assertEquals(10, vm.stagedAttachments.value.size)
        assertEquals("At most 10 attachments per message", vm.consumeAidError())

        vm.unstageAttachment(img.id)
        assertEquals(9, vm.stagedAttachments.value.size)
    }

    @Test fun `local-mlkit routes to on-device`() = runTest(main) {
        val device = object : studio.ccez.app.device.OnDeviceChat {
            override suspend fun status() = studio.ccez.app.device.OnDeviceStatus.Ready
            override suspend fun chat(prompt: String) = "echo:$prompt"
        }
        val vm = ChatViewModel(onDevice = device, aidDispatcher = main)
        vm.setProvider("local-mlkit")
        vm.setDraft("hi")
        vm.send()
        main.scheduler.advanceUntilIdle()
        val msgs = vm.repo.current().activeChat!!.messages
        assertEquals(2, msgs.size)
        assertTrue(msgs[1].content.startsWith("echo:"))
        assertTrue(msgs[1].content.contains("hi"))
        assertFalse(vm.repo.current().sending)
    }

    @Test fun `tashkeel with no arabic reports honestly`() = runTest(main) {
        val vm = ChatViewModel(pinyinReader = fakePinyin, aidDispatcher = main)
        val chat = vm.repo.newChat()
        val msg = ChatMsg(role = ChatMsg.Role.USER, content = "hello")
        vm.toggleTashkeel(chat.id, msg)
        main.scheduler.advanceUntilIdle()
        assertEquals("No Arabic lines in this message", vm.consumeAidError())
        assertNull(vm.consumeAidError())
    }
}
