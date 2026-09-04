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
import com.clawchat.android.core.data.model.Event
import com.clawchat.android.core.data.model.EventCreate
import com.clawchat.android.core.data.model.EventUpdate
import com.clawchat.android.core.data.model.PaginatedResponse
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

class EventRepositoryTest {
    private val api = mockk<ClawChatApi>()
    private val eventDao = mockk<EventDao>(relaxed = true)
    private val localEventDao = mockk<LocalEventDao>(relaxed = true)
    private val zoneId = ZoneId.of("Asia/Seoul")
    private val deviceZoneProvider = mockk<DeviceZoneProvider> {
        every { current() } returns zoneId
    }
    private val sessionStore = mockk<SessionStore> {
        every { runtimeState } returns flowOf(localRuntimeState())
    }
    private val repository = EventRepositoryImpl(
        api,
        eventDao,
        localEventDao,
        sessionStore,
        deviceZoneProvider,
    )

    @Test
    fun `local mode CRUD never calls the server`() = runTest {
        val stored = localEvent("event-1", "Local meeting")
        val fromInclusive = LocalDate.parse("2026-08-01")
            .atStartOfDay(zoneId).toInstant().toEpochMilli()
        val toExclusive = LocalDate.parse("2026-09-01")
            .atStartOfDay(zoneId).toInstant().toEpochMilli()
        coEvery {
            localEventDao.getBetween(fromInclusive, toExclusive)
        } returns listOf(stored)
        coEvery { localEventDao.getById("event-1") } returns stored
        coEvery {
            localEventDao.updateExisting("event-1", any(), any(), any())
        } returns stored.copy(title = "Updated")

        val listed = repository.listEvents(
            LocalDate.parse("2026-08-01"),
            LocalDate.parse("2026-08-31"),
        )
        val created = repository.createEvent(
            EventCreate(title = "Dentist", startTime = "2026-08-31T09:00:00"),
        )
        val updated = repository.updateEvent("event-1", EventUpdate(title = "Updated"))
        val deleted = repository.deleteEvent("event-1")

        assertEquals(listOf("event-1"), (listed as ApiResult.Success).data.map { it.id })
        assertTrue(created is ApiResult.Success)
        val createdEvent = (created as ApiResult.Success).data
        assertEquals("2026-08-31T09:00+09:00", createdEvent.startTime)
        assertEquals("Updated", (updated as ApiResult.Success).data.title)
        assertTrue(deleted is ApiResult.Success)
        // Creation writes once; updateExisting owns its transactional write.
        coVerify(exactly = 1) { localEventDao.upsert(any()) }
        coVerify(exactly = 1) {
            localEventDao.updateExisting("event-1", any(), any(), any())
        }
        coVerify(exactly = 1) { localEventDao.deleteById("event-1") }
        coVerify(exactly = 0) { api.listEvents(any(), any()) }
        coVerify(exactly = 0) { api.createEvent(any(), any()) }
        coVerify(exactly = 0) { api.updateEvent(any(), any(), any()) }
        coVerify(exactly = 0) { api.deleteEvent(any(), any()) }
    }

    @Test
    fun `local recurrence is rejected without touching storage or server`() = runTest {
        val result = repository.createEvent(
            EventCreate(
                title = "Unsupported repeat",
                startTime = "2026-08-31T09:00:00",
                recurrenceRule = "FREQ=WEEKLY",
            ),
        )

        assertTrue(result is ApiResult.Error)
        coVerify(exactly = 0) { localEventDao.upsert(any()) }
        coVerify(exactly = 0) { api.createEvent(any(), any()) }
    }

    @Test
    fun `successful server create caches the event in its captured workspace`() = runTest {
        val states = MutableStateFlow(
            serverRuntimeState("server:url:create", "https://create.example"),
        )
        val serverRepository = serverRepository(states)
        val request = EventCreate(
            title = "Created remotely",
            startTime = "2026-08-31T09:00:00+09:00",
        )
        coEvery { api.createEvent(request, any()) } returns
            serverEvent("created-id", "Created remotely")

        val result = serverRepository.createEvent(request)

        assertTrue(result is ApiResult.Success)
        coVerify(exactly = 1) {
            eventDao.upsertAll(match { rows ->
                rows.singleOrNull()?.workspaceKey == "server:url:create" &&
                    rows.single().id == "created-id"
            })
        }
    }

    @Test
    fun `late server update caches only in the workspace that started it`() = runTest {
        val states = MutableStateFlow(
            serverRuntimeState("server:url:old", "https://old.example"),
        )
        val serverRepository = serverRepository(states)
        val request = EventUpdate(title = "Updated remotely")
        coEvery { api.updateEvent("shared-id", request, any()) } answers {
            states.value = serverRuntimeState("server:url:new", "https://new.example")
            serverEvent("shared-id", "Updated remotely")
        }

        val result = serverRepository.updateEvent("shared-id", request)

        assertTrue(result is ApiResult.Success)
        coVerify(exactly = 1) {
            eventDao.upsertAll(match { rows ->
                rows.singleOrNull()?.workspaceKey == "server:url:old" &&
                    rows.single().id == "shared-id" &&
                    rows.single().title == "Updated remotely"
            })
        }
    }

    @Test
    fun `late server delete removes only the workspace that started it`() = runTest {
        val states = MutableStateFlow(
            serverRuntimeState("server:url:old", "https://old.example"),
        )
        val serverRepository = serverRepository(states)
        coEvery { api.deleteEvent("shared-id", any()) } answers {
            states.value = serverRuntimeState("server:url:new", "https://new.example")
        }

        val result = serverRepository.deleteEvent("shared-id")

        assertTrue(result is ApiResult.Success)
        coVerify(exactly = 1) { eventDao.deleteById("server:url:old", "shared-id") }
    }

    @Test
    fun `late server calendar response replaces only its original workspace range`() = runTest {
        val states = MutableStateFlow(serverRuntimeState("server:url:old", "https://old.example"))
        val switchingRepository = serverRepository(states)
        coEvery { api.listEvents(any(), any()) } answers {
            states.value = serverRuntimeState("server:url:new", "https://new.example")
            PaginatedResponse(
                items = listOf(
                    Event(
                        id = "shared-id",
                        title = "Old workspace meeting",
                        startTime = "2026-08-12T10:00:00+09:00",
                    ),
                ),
            )
        }

        val result = switchingRepository.listEvents(
            LocalDate.parse("2026-08-01"),
            LocalDate.parse("2026-08-31"),
        )

        assertTrue(result is ApiResult.Success)
        coVerify(exactly = 1) {
            eventDao.replaceRange(
                "server:url:old",
                "2026-08-01T00:00:00",
                "2026-09-01T00:00:00",
                match { rows ->
                    rows.singleOrNull()?.workspaceKey == "server:url:old" &&
                        rows.single().id == "shared-id"
                },
            )
        }
    }

    private fun localEvent(id: String, title: String) = LocalEventEntity(
        id = id,
        title = title,
        startTime = "2026-08-31T09:00+09:00",
        startEpochMillis = LocalDate.parse("2026-08-31")
            .atTime(9, 0).atZone(zoneId).toInstant().toEpochMilli(),
        createdAt = "2026-08-30T00:00:00Z",
        updatedAt = "2026-08-30T00:00:00Z",
    )

    private fun serverEvent(id: String, title: String) = Event(
        id = id,
        title = title,
        startTime = "2026-08-31T09:00:00+09:00",
        createdAt = "2026-08-30T00:00:00Z",
        updatedAt = "2026-08-31T00:00:00Z",
    )

    private fun serverRepository(states: MutableStateFlow<AppRuntimeState>): EventRepositoryImpl {
        val serverSessionStore = mockk<SessionStore> {
            every { runtimeState } returns states
        }
        return EventRepositoryImpl(
            api,
            eventDao,
            localEventDao,
            serverSessionStore,
            deviceZoneProvider,
        )
    }

    private fun localRuntimeState() = AppRuntimeState(
        mode = WorkspaceMode.LOCAL,
        activeSession = null,
        hasSavedServerSession = false,
        workspaceKey = "local",
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
