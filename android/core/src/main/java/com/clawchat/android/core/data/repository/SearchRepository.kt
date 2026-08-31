package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.local.LocalEventDao
import com.clawchat.android.core.data.local.LocalTodoDao
import com.clawchat.android.core.data.model.SearchHit
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.apiCall
import com.clawchat.android.core.network.workspaceNotConfigured
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Content the server can search. The filter values are plural, while the
 * `type` a hit carries is singular — the server's contract, not a typo.
 */
enum class SearchType(val filterValue: String, val hitValue: String) {
    Tasks("todos", "todo"),
    Events("events", "event"),
    Messages("messages", "message"),
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
    private val localTodoDao: LocalTodoDao,
    private val localEventDao: LocalEventDao,
    private val sessionStore: SessionStore,
) : SearchRepository {

    override suspend fun search(
        query: String,
        types: Set<SearchType>,
        limit: Int,
    ): ApiResult<List<SearchHit>> {
        val runtimeState = sessionStore.runtimeState.first()
        when (runtimeState.mode) {
            WorkspaceMode.UNCONFIGURED -> return workspaceNotConfigured()
            WorkspaceMode.LOCAL, WorkspaceMode.SERVER -> Unit
        }
        val trimmed = query.trim()
        if (trimmed.isEmpty()) return ApiResult.Success(emptyList())
        if (runtimeState.mode == WorkspaceMode.LOCAL) {
            val safeLimit = limit.coerceAtLeast(0)
            if (safeLimit == 0) return ApiResult.Success(emptyList())
            val includeTasks = types.isEmpty() || SearchType.Tasks in types
            val includeEvents = types.isEmpty() || SearchType.Events in types
            if (!includeTasks && !includeEvents) return ApiResult.Success(emptyList())
            val pattern = "%${trimmed.toEscapedLikeLiteral()}%"

            val taskHits = if (includeTasks) {
                localTodoDao.search(pattern, safeLimit)
                    .map { todo ->
                        SearchHit(
                            type = SearchType.Tasks.hitValue,
                            id = todo.id,
                            title = todo.title,
                            preview = todo.description ?: todo.title,
                            createdAt = todo.createdAt,
                        )
                    }
            } else {
                emptyList()
            }
            val eventHits = if (includeEvents) {
                localEventDao.search(pattern, safeLimit)
                    .map { event ->
                        SearchHit(
                            type = SearchType.Events.hitValue,
                            id = event.id,
                            title = event.title,
                            preview = event.description ?: event.title,
                            createdAt = event.createdAt,
                        )
                    }
            } else {
                emptyList()
            }
            return ApiResult.Success(
                (taskHits + eventHits)
                    .sortedWith(
                        compareByDescending<SearchHit>(SearchHit::createdAt)
                            .thenBy { if (it.type == SearchType.Tasks.hitValue) 0 else 1 }
                            .thenBy(SearchHit::id),
                    )
                    .take(safeLimit),
            )
        }
        val params = buildMap {
            put("q", trimmed)
            put("limit", limit.toString())
            // No filter means every type, which is also the server's default.
            if (types.isNotEmpty() && types.size < SearchType.entries.size) {
                put("types", types.joinToString(",") { it.filterValue })
            }
        }
        val expectedScope = runtimeState.activeServerRequestScope()
            ?: return workspaceNotConfigured()
        return apiCall { api.search(params, expectedScope).items }
    }
}

private fun String.toEscapedLikeLiteral(): String = buildString(length) {
    for (character in this@toEscapedLikeLiteral) {
        if (character == '\\' || character == '%' || character == '_') append('\\')
        append(character)
    }
}
