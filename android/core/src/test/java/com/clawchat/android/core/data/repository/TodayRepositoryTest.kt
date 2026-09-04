package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.ActiveSession
import com.clawchat.android.core.data.AppRuntimeState
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.local.DeviceZoneProvider
import com.clawchat.android.core.data.local.EventDao
import com.clawchat.android.core.data.local.LocalEventDao
import com.clawchat.android.core.data.local.LocalEventEntity
import com.clawchat.android.core.data.local.LocalTodoDao
import com.clawchat.android.core.data.local.LocalTodoEntity
import com.clawchat.android.core.data.local.TodoDao
import com.clawchat.android.core.data.model.Event
import com.clawchat.android.core.data.model.TodayResponse
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.network.ApiResult
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class TodayRepositoryTest {
    private val api = mockk<ClawChatApi>()
    private val todoDao = mockk<TodoDao>(relaxed = true)
    private val eventDao = mockk<EventDao>(relaxed = true)
    private val localTodoDao = mockk<LocalTodoDao>(relaxed = true)
    private val localEventDao = mockk<LocalEventDao>(relaxed = true)
    private val zoneId = ZoneId.of("Asia/Seoul")
    private val deviceZoneProvider = mockk<DeviceZoneProvider> {
        every { current() } returns zoneId
    }
    private val sessionStore = mockk<SessionStore> {
        every { runtimeState } returns flowOf(
            AppRuntimeState(
                mode = WorkspaceMode.LOCAL,
                activeSession = null,
                hasSavedServerSession = false,
                workspaceKey = "local",
            ),
        )
    }
    private val repository = TodayRepositoryImpl(
        api,
        todoDao,
        eventDao,
        localTodoDao,
        localEventDao,
        sessionStore,
        deviceZoneProvider,
    )

    @Test
    fun `local today is built only from local rows for that date`() = runTest {
        val date = LocalDate.now(zoneId)
        val day = date.toString()
        coEvery { localTodoDao.getOpenDueBefore(date.plusDays(1).toString()) } returns listOf(
            localTodo("today", day),
            localTodo("overdue", date.minusDays(1).toString()),
        )
        coEvery { localTodoDao.countOpenInbox() } returns 1
        val fromInclusive = date.atStartOfDay(zoneId).toInstant().toEpochMilli()
        val toExclusive = date.plusDays(1).atStartOfDay(zoneId).toInstant().toEpochMilli()
        coEvery { localEventDao.getBetween(fromInclusive, toExclusive) } returns listOf(
            LocalEventEntity(
                id = "today-event",
                title = "Today only",
                startTime = "${day}T10:00:00+09:00",
                startEpochMillis = date.atTime(10, 0).atZone(zoneId).toInstant().toEpochMilli(),
                createdAt = "2026-08-30T00:00:00Z",
                updatedAt = "2026-08-30T00:00:00Z",
            ),
        )

        val result = repository.getToday()

        val today = (result as ApiResult.Success).data
        assertEquals(listOf("today"), today.todayTodos.map { it.id })
        assertEquals(listOf("overdue"), today.overdueTodos.map { it.id })
        assertEquals(listOf("today-event"), today.todayEvents.map { it.id })
        assertEquals(1, today.inboxCount)
        coVerify(exactly = 1) { localEventDao.getBetween(fromInclusive, toExclusive) }
        coVerify(exactly = 0) { api.getToday(any(), any(), any()) }
        coVerify(exactly = 0) { todoDao.getOpenDueBefore(any(), any()) }
        coVerify(exactly = 0) { eventDao.getBetween(any(), any(), any()) }
    }

    @Test
    fun `local briefing does not call the server`() = runTest {
        val result = repository.getBriefing()

        assertTrue(result is ApiResult.Error)
        coVerify(exactly = 0) { api.getBriefing() }
    }

    @Test
    fun `late today response is cached under the workspace that requested it`() = runTest {
        val states = MutableStateFlow(serverRuntimeState("server:url:old", "https://old.example"))
        val switchingSessionStore = mockk<SessionStore> {
            every { runtimeState } returns states
        }
        val switchingRepository = TodayRepositoryImpl(
            api,
            todoDao,
            eventDao,
            localTodoDao,
            localEventDao,
            switchingSessionStore,
            deviceZoneProvider,
        )
        coEvery { api.getToday(any(), any(), any()) } answers {
            states.value = serverRuntimeState("server:url:new", "https://new.example")
            TodayResponse(
                todayTodos = listOf(Todo(id = "todo-1", title = "Old server task")),
                todayEvents = listOf(
                    Event(
                        id = "event-1",
                        title = "Old server event",
                        startTime = "2026-08-31T12:00:00+09:00",
                    ),
                ),
            )
        }

        val result = switchingRepository.getToday()

        assertTrue(result is ApiResult.Success)
        coVerify(exactly = 1) {
            api.getToday(LocalDate.now(zoneId).toString(), 540, any())
        }
        coVerify(exactly = 1) {
            todoDao.upsertAll(match { rows ->
                rows.singleOrNull()?.workspaceKey == "server:url:old"
            })
        }
        coVerify(exactly = 1) {
            eventDao.replaceRange(
                "server:url:old",
                any(),
                any(),
                match { rows -> rows.singleOrNull()?.workspaceKey == "server:url:old" },
            )
        }
    }

    @Test
    fun `cached today queries only the active server workspace`() = runTest {
        val serverSessionStore = mockk<SessionStore> {
            every { runtimeState } returns flowOf(
                serverRuntimeState("server:url:active", "https://active.example"),
            )
        }
        val serverRepository = TodayRepositoryImpl(
            api,
            todoDao,
            eventDao,
            localTodoDao,
            localEventDao,
            serverSessionStore,
            deviceZoneProvider,
        )
        coEvery {
            todoDao.getOpenDueBefore("server:url:active", "2026-09-01")
        } returns emptyList()
        coEvery {
            eventDao.getBetween(
                "server:url:active",
                "2026-08-31T00:00:00",
                "2026-09-01T00:00:00",
            )
        } returns emptyList()

        serverRepository.getCachedToday(LocalDate.parse("2026-08-31"))

        coVerify(exactly = 1) {
            todoDao.getOpenDueBefore("server:url:active", "2026-09-01")
        }
        coVerify(exactly = 1) {
            eventDao.getBetween(
                "server:url:active",
                "2026-08-31T00:00:00",
                "2026-09-01T00:00:00",
            )
        }
    }

    private fun localTodo(id: String, dueDate: String?) = LocalTodoEntity(
        id = id,
        title = id,
        dueDate = dueDate,
        createdAt = "2026-08-30T00:00:00Z",
        updatedAt = "2026-08-30T00:00:00Z",
    )

    private fun serverRuntimeState(workspaceKey: String, apiBaseUrl: String) = AppRuntimeState(
        mode = WorkspaceMode.SERVER,
        activeSession = ActiveSession(
            token = "token",
            apiBaseUrl = apiBaseUrl,
            hostId = null,
            authMode = "manual",
        ),
        hasSavedServerSession = true,
        workspaceKey = workspaceKey,
    )
}
