package com.clawchat.android.core.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** A normalized, directed edge between two tasks. */
@Serializable
data class TaskRelationship(
    val id: String,
    @SerialName("source_task_id") val sourceTaskId: String,
    @SerialName("target_task_id") val targetTaskId: String,
    val type: String,
    val label: String? = null,
    @SerialName("created_by") val createdBy: String,
    @SerialName("proposal_id") val proposalId: String? = null,
    @SerialName("created_at") val createdAt: String,
    @SerialName("updated_at") val updatedAt: String,
)
