package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.local.EventDao
import com.clawchat.android.core.data.local.toEntity
import com.clawchat.android.core.data.local.toModel
import com.clawchat.android.core.data.model.Event
import com.clawchat.android.core.data.model.EventCreate
import com.clawchat.android.core.data.model.EventUpdate
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.apiCall
import com.clawchat.android.core.network.map
import java.time.LocalDate
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
) : EventRepository {

    override suspend fun listEvents(from: LocalDate, to: LocalDate): ApiResult<List<Event>> {
        val result = apiCall {
            api.listEvents(
                mapOf(
                    // Both bounds are required for the server to expand
                    // recurring events across the range.
                    "start_after" to "${from}T00:00:00",
                    "start_before" to "${to}T23:59:59",
                    "limit" to PAGE_LIMIT.toString(),
                ),
            ).items
        }
        if (result is ApiResult.Success) {
            // Expanded repeats share the stored event's id, so caching them
            // would collapse a series into one row. The cache holds the stored
            // events; offline, repeats are simply not shown.
            eventDao.replaceRange(
                from.toString(),
                to.toString(),
                result.data.filterNot { it.isOccurrence }.map { it.toEntity() },
            )
        }
        return result
    }

    override suspend fun cachedEvents(from: LocalDate, to: LocalDate): List<Event> =
        eventDao.getBetween(from.toString(), to.toString()).map { it.toModel() }

    override suspend fun createEvent(body: EventCreate): ApiResult<Event> =
        apiCall { api.createEvent(body) }

    override suspend fun updateEvent(id: String, body: EventUpdate): ApiResult<Event> =
        apiCall { api.updateEvent(id, body) }

    override suspend fun deleteEvent(id: String): ApiResult<Unit> =
        apiCall { api.deleteEvent(id) }

    override suspend fun deleteOccurrence(
        id: String,
        occurrenceDate: String,
        mode: OccurrenceDeleteMode,
    ): ApiResult<Unit> =
        apiCall { api.deleteEventOccurrence(id, occurrenceDate, mode.wireValue) }.map { }

    private companion object {
        // The server caps a page at 200; a month of events stays well inside it.
        const val PAGE_LIMIT = 200
    }
}
