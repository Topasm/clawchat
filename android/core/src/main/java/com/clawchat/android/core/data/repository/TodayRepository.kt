package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.local.EventDao
import com.clawchat.android.core.data.local.TodoDao
import com.clawchat.android.core.data.local.toEntity
import com.clawchat.android.core.data.local.toModel
import com.clawchat.android.core.data.model.BriefingResponse
import com.clawchat.android.core.data.model.Event
import com.clawchat.android.core.data.model.TodayResponse
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.apiCall
import kotlinx.coroutines.flow.first
import java.time.LocalDate
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
) : TodayRepository {

    override suspend fun getToday(): ApiResult<TodayResponse> {
        val result = apiCall { api.getToday() }
        if (result is ApiResult.Success) {
            val today = result.data
            val day = LocalDate.now().toString()
            todoDao.upsertAll((today.todayTodos + today.overdueTodos).map { it.toEntity() })
            // Scoped to today so this does not clear the range the calendar
            // cached, while still dropping an event that was deleted upstream.
            eventDao.replaceRange(day, day, today.todayEvents.map { it.toEntity() })
        }
        return result
    }

    override suspend fun getBriefing(): ApiResult<BriefingResponse> =
        apiCall { api.getBriefing() }

    override suspend fun getCachedToday(today: LocalDate): CachedToday {
        val boundary = today.toString()
        val open = todoDao.getOpenDueThrough(boundary).map { it.toModel() }
        // The server owns the real bucketing; offline, the due date is all the
        // device has to separate what is due today from what is already late.
        val (dueToday, overdue) = open.partition { todo ->
            todo.dueDate?.take(boundary.length) == boundary
        }
        return CachedToday(
            todayTodos = dueToday,
            overdueTodos = overdue,
            todayEvents = eventDao.getAllFlow().first().map { it.toModel() },
        )
    }
}
