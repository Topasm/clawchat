package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.AppRuntimeState
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.local.DeviceZoneProvider
import com.clawchat.android.core.data.local.EventDao
import com.clawchat.android.core.data.local.LocalEventDao
import com.clawchat.android.core.data.local.toEntity
import com.clawchat.android.core.data.local.toLocalEntity
import com.clawchat.android.core.data.local.toModel
import com.clawchat.android.core.data.model.Event
import com.clawchat.android.core.data.model.EventCreate
import com.clawchat.android.core.data.model.EventUpdate
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.apiCall
import com.clawchat.android.core.network.map
import com.clawchat.android.core.network.workspaceNotConfigured
import kotlinx.coroutines.flow.first
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/** How a repeat of a recurring event is removed. */
enum class OccurrenceDeleteMode(val wireValue: String) {
    ThisOnly("this_only"),
    ThisAndFuture("this_and_future"),
    All("all"),
}

interface EventRepository {
    /** Events starting inside [from]..[to], inclusive, with repeats expanded. */
    suspend fun listEvents(from: LocalDate, to: LocalDate): ApiResult<List<Event>>

    /** The last events cached for that range, for when the server is unreachable. */
    suspend fun cachedEvents(from: LocalDate, to: LocalDate): List<Event>

    suspend fun createEvent(body: EventCreate): ApiResult<Event>
    suspend fun updateEvent(id: String, body: EventUpdate): ApiResult<Event>
    suspend fun deleteEvent(id: String): ApiResult<Unit>
    suspend fun deleteOccurrence(
        id: String,
        occurrenceDate: String,
        mode: OccurrenceDeleteMode,
    ): ApiResult<Unit>
}

@Singleton
class EventRepositoryImpl @Inject constructor(
    private val api: ClawChatApi,
    private val eventDao: EventDao,
    private val localEventDao: LocalEventDao,
    private val sessionStore: SessionStore,
    private val deviceZoneProvider: DeviceZoneProvider,
) : EventRepository {

    override suspend fun listEvents(from: LocalDate, to: LocalDate): ApiResult<List<Event>> {
        val runtimeState = currentRuntimeState()
        when (runtimeState.mode) {
            WorkspaceMode.UNCONFIGURED -> return workspaceNotConfigured()
            WorkspaceMode.SERVER -> Unit
            WorkspaceMode.LOCAL -> {
                val (fromInclusive, toExclusive) = localRange(from, to, deviceZoneProvider.current())
                return ApiResult.Success(
                    localEventDao.getBetween(fromInclusive, toExclusive).map { it.toModel() },
                )
            }
        }
        val workspaceKey = runtimeState.workspaceKey?.takeIf(String::isNotBlank)
            ?: return workspaceNotConfigured()
        val expectedScope = runtimeState.activeServerRequestScope()
            ?: return workspaceNotConfigured()
        val result = apiCall {
            api.listEvents(
                mapOf(
                    // Both bounds are required for the server to expand
                    // recurring events across the range.
                    "start_after" to "${from}T00:00:00",
                    "start_before" to "${to}T23:59:59",
                    "limit" to PAGE_LIMIT.toString(),
                ),
                expectedScope,
            ).items
        }
        if (result is ApiResult.Success) {
            // Expanded repeats share the stored event's id, so caching them
            // would collapse a series into one row. The cache holds the stored
            // events; offline, repeats are simply not shown.
            eventDao.replaceRange(
                workspaceKey,
                "${from}T00:00:00",
                "${to.plusDays(1)}T00:00:00",
                result.data.filterNot { it.isOccurrence }.map { it.toEntity(workspaceKey) },
            )
        }
        return result
    }

    override suspend fun cachedEvents(from: LocalDate, to: LocalDate): List<Event> {
        val runtimeState = currentRuntimeState()
        return when (runtimeState.mode) {
            WorkspaceMode.UNCONFIGURED -> emptyList()
            WorkspaceMode.SERVER -> {
                val workspaceKey = runtimeState.workspaceKey?.takeIf(String::isNotBlank)
                    ?: return emptyList()
                eventDao.getBetween(
                    workspaceKey,
                    "${from}T00:00:00",
                    "${to.plusDays(1)}T00:00:00",
                ).map { it.toModel() }
            }
            WorkspaceMode.LOCAL -> {
                val (fromInclusive, toExclusive) = localRange(from, to, deviceZoneProvider.current())
                localEventDao.getBetween(fromInclusive, toExclusive).map { it.toModel() }
            }
        }
    }

    override suspend fun createEvent(body: EventCreate): ApiResult<Event> {
        val runtimeState = currentRuntimeState()
        when (runtimeState.mode) {
            WorkspaceMode.UNCONFIGURED -> return workspaceNotConfigured()
            WorkspaceMode.SERVER -> Unit
            WorkspaceMode.LOCAL -> {
                if (!body.recurrenceRule.isNullOrBlank()) {
                    return ApiResult.Error("Recurring events require a server")
                }
                val now = Instant.now().toString()
                val event = try {
                    body.copy(title = body.title.trim()).toLocalEntity(
                        id = UUID.randomUUID().toString(),
                        now = now,
                        zoneId = deviceZoneProvider.current(),
                    )
                } catch (error: IllegalArgumentException) {
                    return ApiResult.Error(error.message ?: "Invalid local event", code = 422)
                }
                localEventDao.upsert(event)
                return ApiResult.Success(event.toModel())
            }
        }
        val workspaceKey = runtimeState.workspaceKey?.takeIf(String::isNotBlank)
            ?: return workspaceNotConfigured()
        val expectedScope = runtimeState.activeServerRequestScope()
            ?: return workspaceNotConfigured()
        val result = apiCall { api.createEvent(body, expectedScope) }
        if (result is ApiResult.Success) {
            eventDao.upsertAll(listOf(result.data.toEntity(workspaceKey)))
        }
        return result
    }

    override suspend fun updateEvent(id: String, body: EventUpdate): ApiResult<Event> {
        val runtimeState = currentRuntimeState()
        when (runtimeState.mode) {
            WorkspaceMode.UNCONFIGURED -> return workspaceNotConfigured()
            WorkspaceMode.SERVER -> Unit
            WorkspaceMode.LOCAL -> {
                if (!body.recurrenceRule.isNullOrBlank()) {
                    return ApiResult.Error("Recurring events require a server")
                }
                val updated = try {
                    localEventDao.updateExisting(
                        id,
                        body,
                        Instant.now().toString(),
                        deviceZoneProvider.current(),
                    ) ?: return ApiResult.Error("Local event not found", code = 404)
                } catch (error: IllegalArgumentException) {
                    return ApiResult.Error(error.message ?: "Invalid local event", code = 422)
                }
                return ApiResult.Success(updated.toModel())
            }
        }
        val workspaceKey = runtimeState.workspaceKey?.takeIf(String::isNotBlank)
            ?: return workspaceNotConfigured()
        val expectedScope = runtimeState.activeServerRequestScope()
            ?: return workspaceNotConfigured()
        val result = apiCall { api.updateEvent(id, body, expectedScope) }
        if (result is ApiResult.Success) {
            eventDao.upsertAll(listOf(result.data.toEntity(workspaceKey)))
        }
        return result
    }

    override suspend fun deleteEvent(id: String): ApiResult<Unit> {
        val runtimeState = currentRuntimeState()
        when (runtimeState.mode) {
            WorkspaceMode.UNCONFIGURED -> return workspaceNotConfigured()
            WorkspaceMode.SERVER -> Unit
            WorkspaceMode.LOCAL -> {
                localEventDao.deleteById(id)
                return ApiResult.Success(Unit)
            }
        }
        val workspaceKey = runtimeState.workspaceKey?.takeIf(String::isNotBlank)
            ?: return workspaceNotConfigured()
        val expectedScope = runtimeState.activeServerRequestScope()
            ?: return workspaceNotConfigured()
        val result = apiCall { api.deleteEvent(id, expectedScope) }
        if (result is ApiResult.Success) {
            eventDao.deleteById(workspaceKey, id)
        }
        return result
    }

    override suspend fun deleteOccurrence(
        id: String,
        occurrenceDate: String,
        mode: OccurrenceDeleteMode,
    ): ApiResult<Unit> {
        val runtimeState = currentRuntimeState()
        return when (runtimeState.mode) {
            WorkspaceMode.UNCONFIGURED -> workspaceNotConfigured()
            WorkspaceMode.LOCAL -> ApiResult.Error("Recurring events require a server")
            WorkspaceMode.SERVER -> {
                val expectedScope = runtimeState.activeServerRequestScope()
                    ?: return workspaceNotConfigured()
                apiCall {
                    api.deleteEventOccurrence(id, occurrenceDate, mode.wireValue, expectedScope)
                }.map { }
            }
        }
    }

    private suspend fun currentRuntimeState(): AppRuntimeState = sessionStore.runtimeState.first()

    private fun localRange(from: LocalDate, to: LocalDate, zoneId: ZoneId): Pair<Long, Long> =
        from.atStartOfDay(zoneId).toInstant().toEpochMilli() to
            to.plusDays(1).atStartOfDay(zoneId).toInstant().toEpochMilli()

    private companion object {
        // The server caps a page at 200; a month of events stays well inside it.
        const val PAGE_LIMIT = 200
    }
}
