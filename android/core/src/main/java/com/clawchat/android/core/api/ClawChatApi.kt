package com.clawchat.android.core.api

import com.clawchat.android.core.data.model.*
import com.clawchat.android.core.network.ExpectedSessionScope
import retrofit2.Response
import retrofit2.http.*

/**
 * Retrofit interface for all authenticated ClawChat API endpoints.
 * The auth token is added automatically by [AuthInterceptor].
 */
interface ClawChatApi {

    // --- Health ---

    @GET("api/health")
    suspend fun health(): HealthResponse

    // --- Today ---

    @GET("api/today")
    suspend fun getToday(
        @Query("date") date: String? = null,
        @Query("utc_offset_minutes") utcOffsetMinutes: Int? = null,
        @Tag expectedScope: ExpectedSessionScope? = null,
    ): TodayResponse

    @GET("api/today/briefing")
    suspend fun getBriefing(@Tag expectedScope: ExpectedSessionScope? = null): BriefingResponse

    // --- Todos ---

    @GET("api/todos")
    suspend fun listTodos(
        @QueryMap params: Map<String, String> = emptyMap(),
        @Tag expectedScope: ExpectedSessionScope? = null,
    ): PaginatedResponse<Todo>

    @GET("api/todos/{id}")
    suspend fun getTodo(
        @Path("id") id: String,
        @Tag expectedScope: ExpectedSessionScope? = null,
    ): Todo

    @POST("api/todos")
    suspend fun createTodo(
        @Body body: TodoCreate,
        @Tag expectedScope: ExpectedSessionScope? = null,
    ): Todo

    @PATCH("api/todos/{id}")
    suspend fun updateTodo(
        @Path("id") id: String,
        @Body body: TodoUpdate,
        @Tag expectedScope: ExpectedSessionScope? = null,
    ): Todo

    @DELETE("api/todos/{id}")
    suspend fun deleteTodo(
        @Path("id") id: String,
        @Tag expectedScope: ExpectedSessionScope? = null,
    )

    @POST("api/todos/{todoId}/organize")
    suspend fun organizeTodo(
        @Path("todoId") todoId: String,
        @Tag expectedScope: ExpectedSessionScope? = null,
    ): Response<Unit>

    @POST("api/todos/{todoId}/answer-questions")
    suspend fun answerTodoQuestions(
        @Path("todoId") todoId: String,
        @Body body: TodoQuestionAnswersRequest,
        @Tag expectedScope: ExpectedSessionScope? = null,
    ): TodoWorkflowResponse

    @POST("api/todos/{todoId}/skip-questions")
    suspend fun skipTodoQuestions(
        @Path("todoId") todoId: String,
        @Tag expectedScope: ExpectedSessionScope? = null,
    ): TodoWorkflowResponse

    // --- Task relationships ---

    @GET("api/task-relationships")
    suspend fun listTaskRelationships(
        @Query("task_id") taskId: String,
        @Tag expectedScope: ExpectedSessionScope? = null,
    ): List<TaskRelationship>

    // --- Task comments ---

    @GET("api/task-comments")
    suspend fun listTaskComments(
        @Query("todo_ids") todoIds: String,
        @Tag expectedScope: ExpectedSessionScope? = null,
    ): List<TaskComment>

    @POST("api/task-comments")
    suspend fun createTaskComment(
        @Body body: TaskCommentCreateRequest,
        @Tag expectedScope: ExpectedSessionScope? = null,
    ): TaskComment

    @DELETE("api/task-comments/{id}")
    suspend fun deleteTaskComment(
        @Path("id") id: String,
        @Tag expectedScope: ExpectedSessionScope? = null,
    )

    // --- Events ---

    @GET("api/events")
    suspend fun listEvents(
        @QueryMap params: Map<String, String> = emptyMap(),
        @Tag expectedScope: ExpectedSessionScope? = null,
    ): PaginatedResponse<Event>

    @POST("api/events")
    suspend fun createEvent(
        @Body body: EventCreate,
        @Tag expectedScope: ExpectedSessionScope? = null,
    ): Event

    @PATCH("api/events/{id}")
    suspend fun updateEvent(
        @Path("id") id: String,
        @Body body: EventUpdate,
        @Tag expectedScope: ExpectedSessionScope? = null,
    ): Event

    @DELETE("api/events/{id}")
    suspend fun deleteEvent(
        @Path("id") id: String,
        @Tag expectedScope: ExpectedSessionScope? = null,
    )

    @DELETE("api/events/{id}/occurrences/{date}")
    suspend fun deleteEventOccurrence(
        @Path("id") id: String,
        @Path("date") date: String,
        @Query("mode") mode: String,
        @Tag expectedScope: ExpectedSessionScope? = null,
    )

    // --- Search ---

    @GET("api/search")
    suspend fun search(
        @QueryMap params: Map<String, String>,
        @Tag expectedScope: ExpectedSessionScope? = null,
    ): PaginatedResponse<SearchHit>

    // --- Conversations ---

    @GET("api/chat/conversations")
    suspend fun listConversations(@QueryMap params: Map<String, String> = emptyMap()): PaginatedResponse<Conversation>

    @POST("api/chat/conversations")
    suspend fun createConversation(@Body body: Map<String, String>): Conversation

    @GET("api/chat/conversations/{id}")
    suspend fun getConversation(@Path("id") id: String): Conversation

    @GET("api/chat/conversations/{id}/messages")
    suspend fun getMessages(@Path("id") conversationId: String): PaginatedResponse<Message>

    @DELETE("api/chat/conversations/{id}")
    suspend fun deleteConversation(@Path("id") id: String)

    // --- Devices ---

    @GET("api/pairing/devices")
    suspend fun listDevices(): DeviceListResponse

    @DELETE("api/pairing/devices/{id}")
    suspend fun revokeDevice(@Path("id") id: String)

    // --- Settings ---

    @GET("api/settings")
    suspend fun getSettings(): SettingsResponse

    @PUT("api/settings")
    suspend fun saveSettings(@Body payload: Map<String, @JvmSuppressWildcards Any>): SettingsResponse
}
