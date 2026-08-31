package com.clawchat.android.core.api

import com.clawchat.android.core.data.model.Attachment
import com.clawchat.android.core.data.model.ShareTodoCreate
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.network.ExpectedSessionScope
import okhttp3.MultipartBody
import retrofit2.http.Body
import retrofit2.http.Header
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.Query
import retrofit2.http.Tag

/** Multipart endpoints are kept separate from the JSON-only API surface. */
interface AttachmentApi {
    @POST("api/todos")
    suspend fun createSharedTodo(
        @Body body: ShareTodoCreate,
        @Tag expectedScope: ExpectedSessionScope,
    ): Todo

    @Multipart
    @POST("api/attachments")
    suspend fun uploadAttachment(
        @Query("todo_id") todoId: String,
        @Query("idempotency_key") idempotencyKey: String,
        @Header("X-ClawChat-Direct-Only") directOnly: String?,
        @Part file: MultipartBody.Part,
        @Tag expectedScope: ExpectedSessionScope,
    ): Attachment
}
