package com.clawchat.android.core.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class ProjectPlan(
    val id: String,
    val title: String,
    val goal: String? = null,
    @SerialName("root_task_id") val rootTaskId: String? = null,
    @SerialName("conversation_id") val conversationId: String? = null,
    @SerialName("execution_host_label") val hostLabel: String? = null,
    @SerialName("execution_host_online") val hostOnline: Boolean? = null,
)

@Serializable
data class ProjectGraph(val nodes: List<ProjectNode> = emptyList())

@Serializable
data class ProjectNode(
    @SerialName("task_id") val id: String,
    val title: String,
    @SerialName("parent_id") val parentId: String? = null,
    @SerialName("scope_role") val scopeRole: String,
    @SerialName("execution_state") val executionState: String,
    @SerialName("is_ready") val isReady: Boolean = false,
    @SerialName("direct_blocker_ids") val blockers: List<String> = emptyList(),
)

@Serializable
data class ReadyRunRequest(
    @SerialName("require_ready") val requireReady: Boolean,
    val approved: Boolean,
)

@Serializable
data class ReadyRunResult(@SerialName("run_id") val runId: String)
