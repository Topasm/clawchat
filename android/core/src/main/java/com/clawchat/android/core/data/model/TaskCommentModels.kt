package com.clawchat.android.core.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** One entry in a task's user-authored comment thread. */
@Serializable
data class TaskComment(
    val id: String,
    @SerialName("todo_id") val todoId: String,
    val content: String,
    @SerialName("created_by") val createdBy: String,
    @SerialName("created_at") val createdAt: String,
    @SerialName("updated_at") val updatedAt: String,
)

@Serializable
data class TaskCommentCreateRequest(
    @SerialName("todo_id") val todoId: String,
    val content: String,
    @SerialName("idempotency_key") val idempotencyKey: String? = null,
)
