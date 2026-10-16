package com.clawchat.android.core.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Adds a step under a task; without [branchFromId] it goes after the flow's end. */
@Serializable
data class TaskStepCreate(
    val title: String,
    @SerialName("branch_from_id") val branchFromId: String? = null,
)

@Serializable
data class TaskStepResponse(
    val todo: Todo,
    @SerialName("change_id") val changeId: String,
    @SerialName("affected_task_ids") val affectedTaskIds: List<String> = emptyList(),
)

/** A folder on a machine, a vault note or a URL attached to a task. */
@Serializable
data class TodoPath(
    val id: String,
    @SerialName("todo_id") val todoId: String? = null,
    val kind: String,
    @SerialName("host_id") val hostId: String? = null,
    @SerialName("host_label") val hostLabel: String? = null,
    val path: String,
    val label: String? = null,
    /** Belongs to a parent task or the project; shown dimmed. */
    val inherited: Boolean = false,
)
