package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.local.TodoDao
import com.clawchat.android.core.data.local.toEntity
import com.clawchat.android.core.data.local.toModel
import com.clawchat.android.core.data.model.PaginatedResponse
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.data.model.TodoUpdate
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.apiCall
import com.clawchat.android.core.network.map
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

interface TodoRepository {
    suspend fun listTodos(params: Map<String, String> = emptyMap()): ApiResult<PaginatedResponse<Todo>>
    suspend fun createTodo(body: TodoCreate): ApiResult<Todo>
    suspend fun updateTodo(id: String, body: TodoUpdate): ApiResult<Todo>
    suspend fun deleteTodo(id: String): ApiResult<Unit>
    suspend fun organizeTodo(todoId: String): ApiResult<Unit>
    fun getCachedTodosFlow(): Flow<List<Todo>>
}

@Singleton
class TodoRepositoryImpl @Inject constructor(
    private val api: ClawChatApi,
    private val todoDao: TodoDao,
) : TodoRepository {

    override suspend fun listTodos(params: Map<String, String>): ApiResult<PaginatedResponse<Todo>> {
        val result = apiCall { api.listTodos(params) }
        if (result is ApiResult.Success) {
            todoDao.upsertAll(result.data.items.map { it.toEntity() })
        }
        return result
    }

    override suspend fun createTodo(body: TodoCreate): ApiResult<Todo> =
        apiCall { api.createTodo(body) }

    override suspend fun updateTodo(id: String, body: TodoUpdate): ApiResult<Todo> =
        apiCall { api.updateTodo(id, body) }

    override suspend fun deleteTodo(id: String): ApiResult<Unit> =
        apiCall { api.deleteTodo(id) }

    override suspend fun organizeTodo(todoId: String): ApiResult<Unit> =
        apiCall { api.organizeTodo(todoId) }.map { }

    override fun getCachedTodosFlow(): Flow<List<Todo>> =
        todoDao.getAllFlow().map { entities -> entities.map { it.toModel() } }
}
