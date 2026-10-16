package com.clawchat.android.core.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** One move the Inbox made, by itself (`auto`) or for the user (`user`). */
@Serializable
data class InboxRouting(
    val id: String,
    val origin: String,
    /** `task` or `note`: where the capture is now. */
    val kind: String,
    @SerialName("todo_id") val todoId: String? = null,
    @SerialName("note_id") val noteId: String? = null,
    val title: String,
    @SerialName("original_title") val originalTitle: String,
    @SerialName("due_date") val dueDate: String? = null,
    @SerialName("project_folder") val projectFolder: String? = null,
    @SerialName("created_at") val createdAt: String,
    @SerialName("reverted_at") val revertedAt: String? = null,
) {
    val isTask: Boolean get() = kind == "task"
}

@Serializable
data class InboxRoutingList(
    val items: List<InboxRouting> = emptyList(),
    @SerialName("auto_organize") val autoOrganize: Boolean = true,
)

/** A vault project folder no project is named after yet. */
@Serializable
data class ProjectFolderCandidate(
    val name: String,
    val folder: String,
    @SerialName("source_name") val sourceName: String,
    @SerialName("has_todo") val hasTodo: Boolean = false,
)

@Serializable
data class ProjectCreate(val title: String, val description: String? = null)
