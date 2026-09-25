package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.AgentRunApi
import com.clawchat.android.core.data.*
import com.clawchat.android.core.data.model.CliSessionAction
import com.clawchat.android.core.data.model.CliSessionActionResult
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.ExpectedSessionScope
import io.mockk.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class CliSessionRepositoryTest {
    private val api = mockk<AgentRunApi>()
    private val runtime = MutableStateFlow(AppRuntimeState(WorkspaceMode.SERVER,
        ActiveSession("token", "https://host-a.example", null, "manual"), true, "host-a"))
    private val store = mockk<SessionStore> { every { runtimeState } returns runtime }
    private val repository = CliSessionRepository(api, store)

    @Test fun `control request is pinned to the original host`() = runTest {
        coEvery { api.controlCliSession(any(), any(), any(), any()) } returns CliSessionActionResult(true)
        val request = CliSessionAction("stop")
        assertTrue(repository.act("host-a", "claude", "job-1", request) is ApiResult.Success)
        coVerify(exactly = 1) {
            api.controlCliSession("claude", "job-1", request, ExpectedSessionScope("https://host-a.example"))
        }
    }

    @Test fun `old host control never reaches new host`() = runTest {
        runtime.value = runtime.value.copy(workspaceKey = "host-b")
        val result = repository.act("host-a", "codex", "thread-1", CliSessionAction("stop"))
        assertEquals(409, (result as ApiResult.Error).code)
        coVerify(exactly = 0) { api.controlCliSession(any(), any(), any(), any()) }
    }

    @Test fun `local mode does not expose saved server CLI sessions`() = runTest {
        runtime.value = runtime.value.copy(mode = WorkspaceMode.LOCAL, workspaceKey = "local")
        assertTrue(repository.list("local") is ApiResult.Error)
        coVerify(exactly = 0) { api.listCliSessions(any()) }
    }
}
