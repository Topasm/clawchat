package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.model.SearchHit
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.apiCall
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Content the server can search. The filter values are plural, while the
 * `type` a hit carries is singular — the server's contract, not a typo.
 */
enum class SearchType(val filterValue: String, val hitValue: String, val label: String) {
    Tasks("todos", "todo", "Tasks"),
    Events("events", "event", "Events"),
    Messages("messages", "message", "Messages"),
}

interface SearchRepository {
    /** Empty [query] returns no hits without reaching the server, which rejects it. */
    suspend fun search(
        query: String,
        types: Set<SearchType> = emptySet(),
        limit: Int = DEFAULT_SEARCH_LIMIT,
    ): ApiResult<List<SearchHit>>
}

/** The server caps a page at 100; one screen of results needs far less. */
const val DEFAULT_SEARCH_LIMIT: Int = 30

@Singleton
class SearchRepositoryImpl @Inject constructor(
    private val api: ClawChatApi,
) : SearchRepository {

    override suspend fun search(
        query: String,
        types: Set<SearchType>,
        limit: Int,
    ): ApiResult<List<SearchHit>> {
        val trimmed = query.trim()
        if (trimmed.isEmpty()) return ApiResult.Success(emptyList())
        val params = buildMap {
            put("q", trimmed)
            put("limit", limit.toString())
            // No filter means every type, which is also the server's default.
            if (types.isNotEmpty() && types.size < SearchType.entries.size) {
                put("types", types.joinToString(",") { it.filterValue })
            }
        }
        return apiCall { api.search(params).items }
    }
}
