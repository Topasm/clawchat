package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.AppRuntimeState
import com.clawchat.android.core.data.ActiveSession
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.local.DeviceZoneProvider
import com.clawchat.android.core.data.local.LocalTodoDao
import com.clawchat.android.core.data.local.LocalTodoEntity
import com.clawchat.android.core.data.local.LocalTodoPage
import com.clawchat.android.core.data.local.TodoDao
import com.clawchat.android.core.data.local.toEntity
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.data.model.TodoUpdate
import com.clawchat.android.core.data.model.TodoQuestionAnswersRequest
import com.clawchat.android.core.data.model.TodoWorkflowResponse
import com.clawchat.android.core.data.model.PaginatedResponse
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.notification.ReminderNotificationController
import com.clawchat.android.core.sync.PendingTodoUpdate
import com.clawchat.android.core.sync.PendingTodoUpdateStore
import com.clawchat.android.core.sync.SyncManager
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Response
import java.io.IOException
import java.time.ZoneId

class TodoRepositoryTest {
    private val api = mockk<ClawChatApi>()
    private val todoDao = mockk<TodoDao>(relaxed = true)
    private val localTodoDao = mockk<LocalTodoDao>(relaxed = true)
    private val sessionStore = mockk<SessionStore> {
        every { runtimeState } returns flowOf(appRuntimeState(WorkspaceMode.SERVER))
    }
    private val deviceZoneProvider = mockk<DeviceZoneProvider> {
        every { current() } returns ZoneId.of("Asia/Seoul")
    }
    private val syncManager = mockk<SyncManager>(relaxed = true)
    private val pendingUpdates = mockk<PendingTodoUpdateStore>(relaxed = true) {
        coEvery { allForWorkspace(any()) } returns emptyList()
        coEvery { forWorkspace(any()) } returns emptyList()
        coEvery { forTodo(any(), any()) } returns emptyList()
    }
    private val reminderNotifications = mockk<ReminderNotificationController>(relaxed = true)
    private val repository = TodoRepositoryImpl(
        api,
        todoDao,
        localTodoDao,
        sessionStore,
        deviceZoneProvider,
        syncManager,
        pendingUpdates,
        reminderNotifications,
    )

    @Test
    fun `successful quick add is written to Room`() = runTest {
        val request = TodoCreate(
            title = "Call Ada",
            source = "widget_quick_add",
            inboxState = "captured",
            idempotencyKey = "00000000-0000-0000-0000-000000000001",
        )
        coEvery { api.createTodo(request, any()) } returns todo("todo-new", "Call Ada")

        val result = repository.createTodo(request)

        assertTrue(result is ApiResult.Success)
        coVerify(exactly = 1) {
            todoDao.upsertAll(match { rows ->
                rows.singleOrNull()?.id == "todo-new" &&
                    rows.single().title == "Call Ada" &&
                    rows.single().workspaceKey == "server:url:test"
            })
        }
        io.mockk.verify(exactly = 1) { syncManager.notifyTodoChanged() }
    }

    @Test
    fun `successful completion replaces the cached task`() = runTest {
        val request = TodoUpdate(status = TaskStatus.COMPLETED)
        coEvery {
            api.updateTodo(
                "todo-1",
                match { it.status == TaskStatus.COMPLETED && it.clientUpdatedAt != null },
                any(),
            )
        } returns
            todo("todo-1", "Ship widget", TaskStatus.COMPLETED)

        val result = repository.updateTodo("todo-1", request)

        assertTrue(result is ApiResult.Success)
        coVerify(exactly = 1) {
            todoDao.upsertAll(match { rows ->
                rows.singleOrNull()?.status == TaskStatus.COMPLETED.wireValue &&
                    rows.single().workspaceKey == "server:url:test"
            })
        }
        io.mockk.verify(exactly = 1) {
            reminderNotifications.dismissTodo("server:url:test", "todo-1")
        }
    }

    @Test
    fun `successful delete removes the cached task`() = runTest {
        coEvery { api.deleteTodo("todo-1", any()) } returns Unit

        val result = repository.deleteTodo("todo-1")

        assertTrue(result is ApiResult.Success)
        coVerify(exactly = 1) { todoDao.deleteById("server:url:test", "todo-1") }
        io.mockk.verify(exactly = 1) {
            reminderNotifications.dismissTodo("server:url:test", "todo-1")
        }
    }

    @Test
    fun `offline create is queued with a stable id and cached immediately`() = runTest {
        val operationId = "00000000-0000-0000-0000-000000000099"
        val request = TodoCreate(
            title = "Captured offline",
            inboxState = "captured",
            idempotencyKey = operationId,
        )
        coEvery { api.createTodo(request, any()) } throws IOException("offline")

        val result = repository.createTodo(request)

        assertTrue(result is ApiResult.Success)
        val optimistic = (result as ApiResult.Success).data
        assertEquals(operationId, optimistic.id)
        assertEquals("pending", optimistic.syncStatus)
        coVerify(exactly = 1) {
            pendingUpdates.enqueueCreate(
                "server:url:test",
                operationId,
                request,
                any(),
            )
        }
        coVerify(exactly = 1) {
            todoDao.upsertAll(match { it.single().id == operationId })
        }
    }

    @Test
    fun `offline delete hides the task and queues a tombstone`() = runTest {
        coEvery { api.deleteTodo("todo-1", any()) } throws IOException("offline")

        val result = repository.deleteTodo("todo-1")

        assertTrue(result is ApiResult.Success)
        coVerify(exactly = 1) {
            pendingUpdates.enqueueDelete("server:url:test", "todo-1", any())
        }
        coVerify(exactly = 1) { todoDao.deleteById("server:url:test", "todo-1") }
        io.mockk.verify(exactly = 1) { syncManager.notifyTodoChanged() }
    }

    @Test
    fun `deleting an offline create never calls delete with its local id`() = runTest {
        coEvery { pendingUpdates.hasPendingCreate("server:url:test", "local-1") } returns true

        val result = repository.deleteTodo("local-1")

        assertTrue(result is ApiResult.Success)
        coVerify(exactly = 0) { api.deleteTodo(any(), any()) }
        coVerify(exactly = 1) {
            pendingUpdates.enqueueDelete("server:url:test", "local-1", any())
        }
    }

    @Test
    fun `offline mutation is queued and applied optimistically to Room`() = runTest {
        coEvery { api.updateTodo(any(), any(), any()) } throws IOException("offline")
        coEvery { todoDao.getById("server:url:test", "todo-1") } returns
            todo("todo-1", "Offline task").toEntity("server:url:test")

        val result = repository.updateTodo(
            "todo-1",
            TodoUpdate(status = TaskStatus.COMPLETED),
        )

        assertTrue(result is ApiResult.Success)
        assertEquals(TaskStatus.COMPLETED, (result as ApiResult.Success).data.status)
        coVerify(exactly = 1) {
            pendingUpdates.enqueue(
                "server:url:test",
                "todo-1",
                TodoUpdate(status = TaskStatus.COMPLETED),
                any(),
            )
        }
        coVerify(exactly = 1) {
            todoDao.upsertAll(match { it.single().status == TaskStatus.COMPLETED.wireValue })
        }
        coVerify(exactly = 0) { todoDao.deleteById(any(), any()) }
        io.mockk.verify(exactly = 1) {
            reminderNotifications.dismissTodo("server:url:test", "todo-1")
        }
        io.mockk.verify(exactly = 1) { syncManager.notifyTodoChanged() }
    }

    @Test
    fun `server refresh keeps a pending phone edit visible`() = runTest {
        val serverTodo = todo("todo-1", "Server title")
        coEvery { api.listTodos(emptyMap(), any()) } returns PaginatedResponse(
            items = listOf(serverTodo),
            total = 1,
            page = 1,
            limit = 50,
        )
        coEvery { pendingUpdates.allForWorkspace("server:url:test") } returns listOf(
            PendingTodoUpdate(
                operationId = "operation-1",
                todoId = "todo-1",
                update = TodoUpdate(title = "Phone title"),
                changedAt = "2026-09-01T01:00:00Z",
            ),
        )

        val result = repository.listTodos()

        assertTrue(result is ApiResult.Success)
        assertEquals("Phone title", (result as ApiResult.Success).data.items.single().title)
        assertEquals("pending", result.data.items.single().syncStatus)
        coVerify(exactly = 1) {
            todoDao.upsertAll(match { rows ->
                rows.singleOrNull()?.title == "Phone title"
            })
        }
    }

    @Test
    fun `successful organize accepts an HTTP success response`() = runTest {
        coEvery { api.organizeTodo("todo-1", any()) } returns Response.success(Unit)

        val result = repository.organizeTodo("todo-1")

        assertTrue(result is ApiResult.Success)
        // The server pipeline publishes the real state transition later; an
        // immediate invalidation here would overwrite Inbox's optimistic UI.
        io.mockk.verify(exactly = 0) { syncManager.notifyTodoChanged() }
    }

    @Test
    fun `failed organize does not publish a change`() = runTest {
        coEvery { api.organizeTodo("todo-1", any()) } returns
            Response.error(500, "failed".toResponseBody())

        val result = repository.organizeTodo("todo-1")

        assertTrue(result is ApiResult.Error)
        io.mockk.verify(exactly = 0) { syncManager.notifyTodoChanged() }
    }

    @Test
    fun `answer questions trims values and starts planning`() = runTest {
        coEvery {
            api.answerTodoQuestions(
                "todo-1",
                TodoQuestionAnswersRequest(mapOf("0" to "Friday", "1" to "Email")),
                any(),
            )
        } returns TodoWorkflowResponse(status = "processing", todoId = "todo-1")

        val result = repository.answerTodoQuestions(
            "todo-1",
            mapOf("0" to "  Friday  ", "1" to "Email"),
        )

        assertTrue(result is ApiResult.Success)
        coVerify(exactly = 1) {
            api.answerTodoQuestions(
                "todo-1",
                TodoQuestionAnswersRequest(mapOf("0" to "Friday", "1" to "Email")),
                any(),
            )
        }
    }

    @Test
    fun `answer questions rejects incomplete answers before network`() = runTest {
        val result = repository.answerTodoQuestions(
            "todo-1",
            mapOf("0" to "Friday", "1" to "   "),
        )

        assertTrue(result is ApiResult.Error)
        coVerify(exactly = 0) { api.answerTodoQuestions(any(), any(), any()) }
    }

    @Test
    fun `skip questions starts planning`() = runTest {
        coEvery { api.skipTodoQuestions("todo-1", any()) } returns
            TodoWorkflowResponse(status = "processing", todoId = "todo-1")

        val result = repository.skipTodoQuestions("todo-1")

        assertTrue(result is ApiResult.Success)
        coVerify(exactly = 1) { api.skipTodoQuestions("todo-1", any()) }
    }

    @Test
    fun `stale question response is reported as conflict`() = runTest {
        coEvery { api.skipTodoQuestions("todo-1", any()) } returns TodoWorkflowResponse(
            status = "invalid_state",
            todoId = "todo-1",
            inboxState = "plan_ready",
        )

        val result = repository.skipTodoQuestions("todo-1")

        assertTrue(result is ApiResult.Error)
        assertEquals(409, (result as ApiResult.Error).code)
    }

    @Test
    fun `response that finishes after a switch stays in its original workspace cache`() = runTest {
        val states = MutableStateFlow(
            appRuntimeState(
                mode = WorkspaceMode.SERVER,
                workspaceKey = "server:url:old",
                apiBaseUrl = "https://old.example",
            ),
        )
        val switchingSessionStore = mockk<SessionStore> {
            every { runtimeState } returns states
        }
        val switchingRepository = TodoRepositoryImpl(
            api,
            todoDao,
            localTodoDao,
            switchingSessionStore,
            deviceZoneProvider,
            syncManager,
            pendingUpdates,
            reminderNotifications,
        )
        val request = TodoCreate(
            title = "Old workspace result",
            idempotencyKey = "00000000-0000-0000-0000-000000000042",
        )
        coEvery { api.createTodo(request, any()) } answers {
            states.value = appRuntimeState(
                mode = WorkspaceMode.SERVER,
                workspaceKey = "server:url:new",
                apiBaseUrl = "https://new.example",
            )
            todo("shared-id", "Old workspace result")
        }

        val result = switchingRepository.createTodo(request)

        assertTrue(result is ApiResult.Success)
        coVerify(exactly = 1) {
            todoDao.upsertAll(match { rows ->
                rows.singleOrNull()?.workspaceKey == "server:url:old" &&
                    rows.single().id == "shared-id"
            })
        }
    }

    @Test
    fun `cached flow observes only the active server workspace`() = runTest {
        val states = MutableStateFlow(
            appRuntimeState(
                mode = WorkspaceMode.SERVER,
                workspaceKey = "server:url:one",
                apiBaseUrl = "https://one.example",
            ),
        )
        val scopedSessionStore = mockk<SessionStore> {
            every { runtimeState } returns states
        }
        every { todoDao.getAllFlow("server:url:one") } returns flowOf(emptyList())
        val scopedRepository = TodoRepositoryImpl(
            api,
            todoDao,
            localTodoDao,
            scopedSessionStore,
            deviceZoneProvider,
            syncManager,
            pendingUpdates,
            reminderNotifications,
        )

        scopedRepository.getCachedTodosFlow().first()

        io.mockk.verify(exactly = 1) { todoDao.getAllFlow("server:url:one") }
    }

    @Test
    fun `local mode CRUD uses only the device table`() = runTest {
        val localSessionStore = mockk<SessionStore> {
            every { runtimeState } returns flowOf(appRuntimeState(WorkspaceMode.LOCAL))
        }
        val localRepository = TodoRepositoryImpl(
            api,
            todoDao,
            localTodoDao,
            localSessionStore,
            deviceZoneProvider,
            syncManager,
            pendingUpdates,
            reminderNotifications,
        )
        val stored = LocalTodoEntity(
            id = "local-id",
            title = "Write offline",
            status = TaskStatus.PENDING.wireValue,
            createdAt = "2026-08-31T00:00:00Z",
            updatedAt = "2026-08-31T00:00:00Z",
        )
        coEvery {
            localTodoDao.loadPage(
                "pending",
                null,
                null,
                false,
                null,
                false,
                null,
                "default",
                false,
                20,
                0,
            )
        } returns LocalTodoPage(listOf(stored), total = 1)
        coEvery { localTodoDao.getById("local-id") } returns stored
        coEvery { localTodoDao.insertOrGet(any()) } answers { firstArg() }
        coEvery {
            localTodoDao.updateExisting("local-id", any(), any(), any())
        } returns stored.copy(
            status = TaskStatus.COMPLETED.wireValue,
            completedAt = "2026-08-31T01:00:00Z",
        )

        val listed = localRepository.listTodos(mapOf("status" to "pending", "limit" to "20"))
        val created = localRepository.createTodo(
            TodoCreate(title = "New local task", inboxState = "captured"),
        )
        val updated = localRepository.updateTodo(
            "local-id",
            TodoUpdate(status = TaskStatus.COMPLETED),
        )
        val deleted = localRepository.deleteTodo("local-id")

        assertTrue(listed is ApiResult.Success)
        assertEquals(listOf("local-id"), (listed as ApiResult.Success).data.items.map(Todo::id))
        assertTrue(created is ApiResult.Success)
        assertEquals("captured", (created as ApiResult.Success).data.inboxState)
        assertTrue(updated is ApiResult.Success)
        val updatedTodo = (updated as ApiResult.Success).data
        assertEquals(TaskStatus.COMPLETED, updatedTodo.status)
        assertTrue(updatedTodo.completedAt.isNullOrBlank().not())
        assertTrue(deleted is ApiResult.Success)
        coVerify(exactly = 1) { localTodoDao.insertOrGet(any()) }
        coVerify(exactly = 1) {
            localTodoDao.updateExisting("local-id", any(), any(), any())
        }
        // insertOrGet and updateExisting own their writes inside DAO transactions.
        coVerify(exactly = 0) { localTodoDao.upsert(any()) }
        coVerify(exactly = 1) { localTodoDao.deleteById("local-id") }
        coVerify(exactly = 0) { api.listTodos(any(), any()) }
        coVerify(exactly = 0) { api.createTodo(any(), any()) }
        coVerify(exactly = 0) { api.updateTodo(any(), any(), any()) }
        coVerify(exactly = 0) { api.deleteTodo(any(), any()) }
        io.mockk.verify(exactly = 3) { syncManager.notifyTodoChanged() }
    }

    @Test
    fun `local pagination and due boundary are delegated to Room`() = runTest {
        val localSessionStore = mockk<SessionStore> {
            every { runtimeState } returns flowOf(appRuntimeState(WorkspaceMode.LOCAL))
        }
        val localRepository = TodoRepositoryImpl(
            api,
            todoDao,
            localTodoDao,
            localSessionStore,
            deviceZoneProvider,
            syncManager,
            pendingUpdates,
            reminderNotifications,
        )
        coEvery {
            localTodoDao.loadPage(
                "in_progress",
                null,
                null,
                false,
                null,
                false,
                "2026-09-02",
                "due_date",
                false,
                1000,
                1000,
            )
        } returns LocalTodoPage(emptyList(), total = 1_201)

        val result = localRepository.listTodos(
            mapOf(
                "status" to "in_progress",
                "due_before" to "2026-08-31T15:00:00Z",
                "order_by" to "due_date",
                "order_dir" to "desc",
                "page" to "2",
                "limit" to "1000",
            ),
        )

        val page = (result as ApiResult.Success).data
        assertEquals(1_201, page.total)
        assertEquals(2, page.page)
        coVerify(exactly = 1) { localTodoDao.loadPage(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()) }
    }

    @Test
    fun `delayed mutation is rejected after its workspace changes`() = runTest {
        val localSessionStore = mockk<SessionStore> {
            every { runtimeState } returns flowOf(appRuntimeState(WorkspaceMode.LOCAL))
        }
        val localRepository = TodoRepositoryImpl(
            api,
            todoDao,
            localTodoDao,
            localSessionStore,
            deviceZoneProvider,
            syncManager,
            pendingUpdates,
            reminderNotifications,
        )

        val result = localRepository.createTodo(
            TodoCreate(title = "Stale capture"),
            expectedWorkspaceKey = "server:url:old",
        )

        assertTrue(result is ApiResult.Error)
        assertEquals("workspace_changed", (result as ApiResult.Error).serverCode)
        coVerify(exactly = 0) { localTodoDao.insertOrGet(any()) }
        coVerify(exactly = 0) { api.createTodo(any(), any()) }
    }

    @Test
    fun `local idempotency key produces one stable database identity`() = runTest {
        val localSessionStore = mockk<SessionStore> {
            every { runtimeState } returns flowOf(appRuntimeState(WorkspaceMode.LOCAL))
        }
        val localRepository = TodoRepositoryImpl(
            api,
            todoDao,
            localTodoDao,
            localSessionStore,
            deviceZoneProvider,
            syncManager,
            pendingUpdates,
            reminderNotifications,
        )
        val insertedIds = mutableListOf<String>()
        coEvery { localTodoDao.insertOrGet(any()) } answers {
            firstArg<LocalTodoEntity>().also { insertedIds += it.id }
        }
        val request = TodoCreate(
            title = "Retry-safe capture",
            idempotencyKey = "operation-1",
        )

        localRepository.createTodo(request)
        localRepository.createTodo(request)

        assertEquals(2, insertedIds.size)
        assertEquals(insertedIds.first(), insertedIds.last())
    }

    private fun todo(
        id: String,
        title: String,
        status: TaskStatus = TaskStatus.PENDING,
    ) = Todo(
        id = id,
        title = title,
        status = status,
        createdAt = "2026-08-31T00:00:00Z",
        updatedAt = "2026-08-31T00:00:00Z",
    )

    private fun appRuntimeState(
        mode: WorkspaceMode,
        workspaceKey: String? = when (mode) {
            WorkspaceMode.LOCAL -> "local"
            WorkspaceMode.SERVER -> "server:url:test"
            WorkspaceMode.UNCONFIGURED -> null
        },
        apiBaseUrl: String = "https://workspace.example",
    ) = AppRuntimeState(
        mode = mode,
        activeSession = if (mode == WorkspaceMode.SERVER) {
            ActiveSession(
                token = "token",
                apiBaseUrl = apiBaseUrl,
                hostId = null,
                authMode = "manual",
            )
        } else {
            null
        },
        hasSavedServerSession = mode == WorkspaceMode.SERVER,
        workspaceKey = workspaceKey,
    )
}
