package com.clawchat.android.share

import android.content.Context
import app.cash.turbine.test
import com.clawchat.android.core.data.ActiveSession
import com.clawchat.android.core.data.AppRuntimeState
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.repository.TodoRepository
import com.clawchat.android.core.network.ApiResult
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files
import java.util.UUID

@OptIn(ExperimentalCoroutinesApi::class)
class ShareCaptureCoordinatorTest {
    private val context = mockk<Context>(relaxed = true)
    private val sessionStore = mockk<SessionStore>()
    private val contentStager = mockk<ShareContentStager>()
    private val outboxStore = mockk<ShareOutboxStore>()
    private val todoRepository = mockk<TodoRepository>()

    @Test
    fun `shared text is durably queued before login and delivery is scheduled`() = runTest {
        val staged = stagedShare(text = "https://example.com")
        val scheduledContexts = mutableListOf<Context>()
        everyActiveSession(null)
        coEvery { contentStager.stage(any()) } returns staged
        coEvery { outboxStore.enqueue(any(), staged, null, any()) } answers {
            ShareOutboxEnqueueResult.Enqueued(item(firstArg()))
        }
        val coordinator = coordinator(StandardTestDispatcher(testScheduler)) {
            scheduledContexts += it
        }

        coordinator.events.test {
            coordinator.submit(payload(text = "https://example.com"))
            advanceUntilIdle()

            assertEquals(ShareCaptureEvent.Queued, awaitItem())
            cancelAndIgnoreRemainingEvents()
        }

        coVerify {
            outboxStore.enqueue(
                captureId = match { runCatching { UUID.fromString(it) }.isSuccess },
                staged = staged,
                targetScope = null,
                nowEpochMillis = any(),
            )
        }
        assertEquals(listOf(context), scheduledContexts)
        assertFalse(staged.directory.exists())
        coordinator.closeForTest()
    }

    @Test
    fun `capture is pinned to the connected workspace`() = runTest {
        val staged = stagedShare(text = "Reference")
        everyActiveSession(
            ActiveSession(
                token = "token",
                apiBaseUrl = "https://lab.example/api/",
                hostId = "host-1",
                authMode = "paired",
            ),
        )
        coEvery { contentStager.stage(any()) } returns staged
        coEvery { outboxStore.enqueue(any(), staged, "host-1", any()) } answers {
            ShareOutboxEnqueueResult.Enqueued(item(firstArg(), targetScope = "host-1"))
        }
        val coordinator = coordinator(StandardTestDispatcher(testScheduler))

        coordinator.events.test {
            coordinator.submit(payload(text = "Reference"))
            advanceUntilIdle()
            assertEquals(ShareCaptureEvent.Queued, awaitItem())
            cancelAndIgnoreRemainingEvents()
        }

        coVerify { outboxStore.enqueue(any(), staged, "host-1", any()) }
        coordinator.closeForTest()
    }

    @Test
    fun `shared text is saved directly without queueing in local mode`() = runTest {
        val staged = stagedShare(text = "Read https://example.com")
        everyWorkspace(WorkspaceMode.LOCAL)
        coEvery { contentStager.stage(any()) } returns staged
        coEvery { todoRepository.createTodo(any(), "local") } returns ApiResult.Success(
            Todo(id = "local-1", title = "Read https://example.com"),
        )
        val scheduledContexts = mutableListOf<Context>()
        val coordinator = coordinator(StandardTestDispatcher(testScheduler)) {
            scheduledContexts += it
        }

        coordinator.events.test {
            coordinator.submit(payload(text = "Read https://example.com"))
            advanceUntilIdle()
            assertEquals(ShareCaptureEvent.SavedLocally, awaitItem())
            cancelAndIgnoreRemainingEvents()
        }

        coVerify(exactly = 1) {
            todoRepository.createTodo(
                match { request ->
                    request.title == "Read https://example.com" &&
                        request.source == "share_sheet" &&
                        request.inboxState == "none"
                },
                "local",
            )
        }
        coVerify(exactly = 0) { outboxStore.enqueue(any(), any(), any(), any()) }
        assertTrue(scheduledContexts.isEmpty())
        assertFalse(staged.directory.exists())
        coordinator.closeForTest()
    }

    @Test
    fun `full durable queue is reported and transient staging is removed`() = runTest {
        val staged = stagedShare(text = "Queued item")
        everyActiveSession(null)
        coEvery { contentStager.stage(any()) } returns staged
        coEvery { outboxStore.enqueue(any(), staged, null, any()) } returns
            ShareOutboxEnqueueResult.QueueFull
        val coordinator = coordinator(StandardTestDispatcher(testScheduler))

        coordinator.events.test {
            coordinator.submit(payload(text = "Queued item"))
            advanceUntilIdle()
            assertEquals(ShareCaptureEvent.QueueFull, awaitItem())
            cancelAndIgnoreRemainingEvents()
        }

        assertFalse(staged.directory.exists())
        coordinator.closeForTest()
    }

    @Test
    fun `malformed intent is surfaced without staging any content`() = runTest {
        val coordinator = coordinator(StandardTestDispatcher(testScheduler))

        coordinator.events.test {
            coordinator.malformedIntent()
            assertEquals(ShareCaptureEvent.Malformed, awaitItem())
            cancelAndIgnoreRemainingEvents()
        }

        coVerify(exactly = 0) { contentStager.stage(any()) }
        coordinator.closeForTest()
    }

    private fun everyActiveSession(session: ActiveSession?) {
        io.mockk.every { sessionStore.activeSession } returns MutableStateFlow(session)
        everyWorkspace(
            mode = if (session == null) WorkspaceMode.UNCONFIGURED else WorkspaceMode.SERVER,
            session = session,
        )
    }

    private fun everyWorkspace(
        mode: WorkspaceMode,
        session: ActiveSession? = null,
    ) {
        io.mockk.every { sessionStore.runtimeState } returns MutableStateFlow(
            AppRuntimeState(
                mode = mode,
                activeSession = session,
                hasSavedServerSession = session != null,
                workspaceKey = when (mode) {
                    WorkspaceMode.UNCONFIGURED -> null
                    WorkspaceMode.LOCAL -> "local"
                    WorkspaceMode.SERVER -> "server:test"
                },
            ),
        )
    }

    private fun coordinator(
        dispatcher: CoroutineDispatcher,
        schedule: (Context) -> Unit = {},
    ) = ShareCaptureCoordinator(
        context = context,
        sessionStore = sessionStore,
        contentStager = contentStager,
        outboxStore = outboxStore,
        todoRepository = todoRepository,
        dispatcher = dispatcher,
        scheduleDelivery = schedule,
    )

    private fun payload(text: String? = null) = IncomingSharePayload(
        subject = null,
        text = text,
        streams = emptyList(),
        declaredMimeType = null,
    )

    private fun stagedShare(
        text: String? = null,
        files: List<StagedSharedFile> = emptyList(),
    ): StagedShare {
        val directory = Files.createTempDirectory("clawchat-share-coordinator").toFile()
        assertTrue(directory.isDirectory)
        return StagedShare(
            subject = null,
            text = text,
            files = files,
            rejectedFileCount = 0,
            directory = directory,
        )
    }

    private fun item(
        captureId: String,
        targetScope: String? = null,
    ) = ShareOutboxItem(
        captureId = captureId,
        title = "Shared",
        targetScope = targetScope,
        createdAtEpochMillis = 1,
        updatedAtEpochMillis = 1,
    )
}
