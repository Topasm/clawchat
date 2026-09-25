package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.*
import com.clawchat.android.core.data.local.*
import com.clawchat.android.core.data.model.*
import com.clawchat.android.core.network.*
import io.mockk.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class NoteRepositoryTest {
    private val api = mockk<ClawChatApi>()
    private val dao = mockk<LocalNoteDao>()
    private val todos = mockk<LocalTodoDao>()
    private val runtime = MutableStateFlow(AppRuntimeState(WorkspaceMode.SERVER,
        ActiveSession("token", "https://host-a.example", null, "manual"), true, "host-a"))
    private val sessions = mockk<SessionStore> { every { runtimeState } returns runtime }
    private val repository = NoteRepository(api, sessions, dao, todos)

    @Test fun `moving back to inbox sends explicit null on original host`() = runTest {
        val note = Note("n", "memo", null, "now", "now")
        coEvery { api.moveNote(any(), any(), any()) } returns note
        assertTrue(repository.move("host-a", "n", null) is ApiResult.Success)
        coVerify { api.moveNote("n", NoteMove(null), ExpectedSessionScope("https://host-a.example")) }
        assertEquals("{\"project_id\":null}", Json.encodeToString(NoteMove(null)))
    }

    @Test fun `stale workspace cannot move notes on another host`() = runTest {
        runtime.value = runtime.value.copy(workspaceKey = "host-b")
        assertEquals(409, (repository.move("host-a", "n", "p") as ApiResult.Error).code)
        coVerify(exactly = 0) { api.moveNote(any(), any(), any()) }
    }

    @Test fun `local capture stores memo without a server request`() = runTest {
        runtime.value = runtime.value.copy(mode = WorkspaceMode.LOCAL, workspaceKey = "local")
        coEvery { dao.insert(any()) } just Runs
        coEvery { dao.get("note_capture") } returns LocalNoteEntity("note_capture", "memo", null, "now", "now")
        val result = repository.create("local", NoteCreate("memo", idempotencyKey = "capture"))
        assertTrue(result is ApiResult.Success)
        coVerify(exactly = 1) { dao.insert(match { it.content == "memo" }) }
        coVerify(exactly = 0) { api.createNote(any(), any()) }
    }
}
