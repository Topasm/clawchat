package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.model.PaginatedResponse
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.data.model.TodoUpdate
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.apiCall
import com.clawchat.android.core.network.map
import javax.inject.Inject
import javax.inject.Singleton

interface TodoRepository {
    suspend fun listTodos(params: Map<String, String> = emptyMap()): ApiResult<PaginatedResponse<Todo>>
    suspend fun createTodo(body: TodoCreate): ApiResult<Todo>
    suspend fun updateTodo(id: String, body: TodoUpdate): ApiResult<Todo>
    suspend fun deleteTodo(id: String): ApiResult<Unit>
    suspend fun organizeTodo(todoId: String): ApiResult<Unit>
}

@Singleton
class TodoRepositoryImpl @Inject constructor(
    private val api: ClawChatApi,
) : TodoRepository {

    override suspend fun listTodos(params: Map<String, String>): ApiResult<PaginatedResponse<Todo>> =
        apiCall { api.listTodos(params) }

    override suspend fun createTodo(body: TodoCreate): ApiResult<Todo> =
        apiCall { api.createTodo(body) }

    override suspend fun updateTodo(id: String, body: TodoUpdate): ApiResult<Todo> =
        apiCall { api.updateTodo(id, body) }

    override suspend fun deleteTodo(id: String): ApiResult<Unit> =
        apiCall { api.deleteTodo(id) }

    override suspend fun organizeTodo(todoId: String): ApiResult<Unit> =
        apiCall { api.organizeTodo(todoId) }.map { }
}
