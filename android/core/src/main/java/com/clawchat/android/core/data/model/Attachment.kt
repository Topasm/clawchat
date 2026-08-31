package com.clawchat.android.core.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** A file stored by ClawChat and optionally linked to a task. */
@Serializable
data class Attachment(
    val id: String,
    val filename: String,
    @SerialName("stored_filename") val storedFilename: String,
    @SerialName("content_type") val contentType: String,
    @SerialName("size_bytes") val sizeBytes: Long,
    @SerialName("todo_id") val todoId: String? = null,
    val url: String,
    @SerialName("created_at") val createdAt: String,
)
