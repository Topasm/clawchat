package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.local.DeviceZoneProvider
import com.clawchat.android.core.data.local.EventDao
import com.clawchat.android.core.data.local.LocalEventDao
import com.clawchat.android.core.data.local.LocalTodoDao
import com.clawchat.android.core.data.local.TodoDao
import com.clawchat.android.core.data.local.toEntity
import com.clawchat.android.core.data.local.toModel
import com.clawchat.android.core.data.model.BriefingResponse
import com.clawchat.android.core.data.model.Event
import com.clawchat.android.core.data.model.TodayResponse
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.apiCall
import com.clawchat.android.core.network.workspaceNotConfigured
import kotlinx.coroutines.flow.first
import java.time.LocalDate
import java.time.ZoneId
import javax.inject.Inject
import javax.inject.Singleton

/**
 * What the device can still show for today with no server reachable. Empty
 * when nothing has been synced yet.
 */
data class CachedToday(
    val todayTodos: List<Todo> = emptyList(),
    val overdueTodos: List<Todo> = emptyList(),
    val todayEvents: List<Event> = emptyList(),
) {
    val isEmpty: Boolean
        get() = todayTodos.isEmpty() && overdueTodos.isEmpty() && todayEvents.isEmpty()
}

interface TodayRepository {
    suspend fun getToday(): ApiResult<TodayResponse>
    suspend fun getBriefing(): ApiResult<BriefingResponse>

    /** Replays the last synced day so an offline launch is not a blank screen. */
    suspend fun getCachedToday(today: LocalDate = LocalDate.now()): CachedToday
}

@Singleton
class TodayRepositoryImpl @Inject constructor(
    private val api: ClawChatApi,
    private val todoDao: TodoDao,
    private val eventDao: EventDao,
    private val localTodoDao: LocalTodoDao,
    private val localEventDao: LocalEventDao,
    private val sessionStore: SessionStore,
    private val deviceZoneProvider: DeviceZoneProvider,
) : TodayRepository {

    override suspend fun getToday(): ApiResult<TodayResponse> {
        val runtimeState = currentRuntimeState()
        when (runtimeState.mode) {
            WorkspaceMode.UNCONFIGURED -> return workspaceNotConfigured()
            WorkspaceMode.SERVER -> Unit
            WorkspaceMode.LOCAL -> {
                val zoneId = deviceZoneProvider.current()
                val local = getLocalToday(LocalDate.now(zoneId), zoneId)
                return ApiResult.Success(
                    TodayResponse(
                        todayTodos = local.todayTodos,
                        overdueTodos = local.overdueTodos,
                        todayEvents = local.todayEvents,
                        inboxCount = localTodoDao.countUndatedPending(),
                    ),
                )
            }
        }
        val workspaceKey = runtimeState.workspaceKey?.takeIf(String::isNotBlank)
            ?: return workspaceNotConfigured()
        val expectedScope = runtimeState.activeServerRequestScope()
            ?: return workspaceNotConfigured()
        val result = apiCall { api.getToday(expectedScope) }
        if (result is ApiResult.Success) {
            val today = result.data
            val day = LocalDate.now()
            val fromInclusive = "${day}T00:00:00"
            val toExclusive = "${day.plusDays(1)}T00:00:00"
            todoDao.upsertAll(
                (today.todayTodos + today.overdueTodos).map { it.toEntity(workspaceKey) },
            )
            // Scoped to today so this does not clear the range the calendar
            // cached, while still dropping an event that was deleted upstream.
            eventDao.replaceRange(
                workspaceKey,
                fromInclusive,
                toExclusive,
                today.todayEvents.map { it.toEntity(workspaceKey) },
            )
        }
        return result
    }

    override suspend fun getBriefing(): ApiResult<BriefingResponse> {
        val runtimeState = currentRuntimeState()
        return when (runtimeState.mode) {
            WorkspaceMode.UNCONFIGURED -> workspaceNotConfigured()
            WorkspaceMode.LOCAL -> ApiResult.Error("AI briefing requires a server")
            WorkspaceMode.SERVER -> {
                val expectedScope = runtimeState.activeServerRequestScope()
                    ?: return workspaceNotConfigured()
                apiCall { api.getBriefing(expectedScope) }
            }
        }
    }

    override suspend fun getCachedToday(today: LocalDate): CachedToday {
        val runtimeState = currentRuntimeState()
        when (runtimeState.mode) {
            WorkspaceMode.UNCONFIGURED -> return CachedToday()
            WorkspaceMode.LOCAL -> return getLocalToday(today, deviceZoneProvider.current())
            WorkspaceMode.SERVER -> Unit
        }

        val boundary = today.toString()
        val tomorrow = today.plusDays(1).toString()
        val workspaceKey = runtimeState.workspaceKey?.takeIf(String::isNotBlank)
            ?: return CachedToday()
        val open = todoDao.getOpenDueBefore(workspaceKey, tomorrow).map { it.toModel() }
        // The server owns the real bucketing; offline, the due date is all the
        // device has to separate what is due today from what is already late.
        val (dueToday, overdue) = open.partition { todo ->
            todo.dueDate?.take(boundary.length) == boundary
        }
        return CachedToday(
            todayTodos = dueToday,
            overdueTodos = overdue,
            todayEvents = eventDao.getBetween(
                workspaceKey,
                "${today}T00:00:00",
                "${today.plusDays(1)}T00:00:00",
            ).map { it.toModel() },
        )
    }

    private suspend fun getLocalToday(today: LocalDate, zoneId: ZoneId): CachedToday {
        val boundary = today.toString()
        val tomorrow = today.plusDays(1).toString()
        val open = localTodoDao.getOpenDueBefore(tomorrow).map { it.toModel() }
        val (dueToday, overdue) = open.partition { todo ->
            todo.dueDate?.take(boundary.length) == boundary
        }
        val inProgressOutsideToday = localTodoDao
            .getInProgressOutside(boundary, tomorrow)
            .map { it.toModel() }
        val fromInclusive = today.atStartOfDay(zoneId).toInstant().toEpochMilli()
        val toExclusive = today.plusDays(1).atStartOfDay(zoneId).toInstant().toEpochMilli()
        return CachedToday(
            todayTodos = (dueToday + inProgressOutsideToday).distinctBy(Todo::id),
            overdueTodos = overdue,
            todayEvents = localEventDao.getBetween(fromInclusive, toExclusive).map { it.toModel() },
        )
    }

    private suspend fun currentRuntimeState() = sessionStore.runtimeState.first()

}
