package com.clawchat.android.core.api

import com.clawchat.android.core.data.model.*
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
    suspend fun getToday(): TodayResponse

    @GET("api/today/briefing")
    suspend fun getBriefing(): BriefingResponse

    // --- Todos ---

    @GET("api/todos")
    suspend fun listTodos(@QueryMap params: Map<String, String> = emptyMap()): PaginatedResponse<Todo>

    @GET("api/todos/{id}")
    suspend fun getTodo(@Path("id") id: String): Todo

    @POST("api/todos")
    suspend fun createTodo(@Body body: TodoCreate): Todo

    @PATCH("api/todos/{id}")
    suspend fun updateTodo(@Path("id") id: String, @Body body: TodoUpdate): Todo

    @DELETE("api/todos/{id}")
    suspend fun deleteTodo(@Path("id") id: String)

    @POST("api/todos/{todoId}/organize")
    suspend fun organizeTodo(@Path("todoId") todoId: String): Response<Unit>

    // --- Task relationships ---

    @GET("api/task-relationships")
    suspend fun listTaskRelationships(@Query("task_id") taskId: String): List<TaskRelationship>

    // --- Events ---

    @GET("api/events")
    suspend fun listEvents(@QueryMap params: Map<String, String> = emptyMap()): PaginatedResponse<Event>

    @POST("api/events")
    suspend fun createEvent(@Body body: EventCreate): Event

    @PATCH("api/events/{id}")
    suspend fun updateEvent(@Path("id") id: String, @Body body: EventUpdate): Event

    @DELETE("api/events/{id}")
    suspend fun deleteEvent(@Path("id") id: String)

    @DELETE("api/events/{id}/occurrences/{date}")
    suspend fun deleteEventOccurrence(
        @Path("id") id: String,
        @Path("date") date: String,
        @Query("mode") mode: String,
    )

    // --- Search ---

    @GET("api/search")
    suspend fun search(@QueryMap params: Map<String, String>): PaginatedResponse<SearchHit>

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
