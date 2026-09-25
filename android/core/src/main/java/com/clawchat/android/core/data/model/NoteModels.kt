package com.clawchat.android.core.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Note(
    val id: String,
    val content: String,
    @SerialName("project_id") val projectId: String? = null,
    @SerialName("created_at") val createdAt: String,
    @SerialName("updated_at") val updatedAt: String,
)

@Serializable
data class NoteCreate(
    val content: String,
    @SerialName("project_id") val projectId: String? = null,
    @SerialName("idempotency_key") val idempotencyKey: String,
)

@Serializable
data class NoteContentUpdate(val content: String)

@Serializable
data class NoteMove(@SerialName("project_id") val projectId: String?)
