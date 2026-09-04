package com.clawchat.android.core.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/** Durable lifecycle state for a single agent execution attempt. */
@Serializable
enum class AgentRunStatus(val wireValue: String) {
    @SerialName("queued")
    QUEUED("queued"),

    @SerialName("starting")
    STARTING("starting"),

    @SerialName("running")
    RUNNING("running"),

    @SerialName("waiting_input")
    WAITING_INPUT("waiting_input"),

    @SerialName("waiting_review")
    WAITING_REVIEW("waiting_review"),

    @SerialName("completed")
    COMPLETED("completed"),

    @SerialName("failed")
    FAILED("failed"),

    @SerialName("cancelled")
    CANCELLED("cancelled"),
    ;

    val isExecuting: Boolean
        get() = this == QUEUED || this == STARTING || this == RUNNING

    val isActive: Boolean
        get() = isExecuting || this == WAITING_INPUT || this == WAITING_REVIEW

    val needsAttention: Boolean
        get() = this == WAITING_INPUT || this == WAITING_REVIEW || this == FAILED

    val isTerminal: Boolean
        get() = this == COMPLETED || this == FAILED || this == CANCELLED

    val label: String
        get() = when (this) {
            QUEUED -> "Queued"
            STARTING -> "Starting"
            RUNNING -> "Running"
            WAITING_INPUT -> "Needs input"
            WAITING_REVIEW -> "Ready to review"
            COMPLETED -> "Completed"
            FAILED -> "Failed"
            CANCELLED -> "Cancelled"
        }
}

/** One execution attempt returned by `/api/runs`. */
@Serializable
data class AgentRun(
    val id: String,
    @SerialName("agent_task_id") val agentTaskId: String,
    @SerialName("project_id") val projectId: String? = null,
    @SerialName("project_title") val projectTitle: String? = null,
    @SerialName("todo_id") val todoId: String? = null,
    @SerialName("todo_title") val todoTitle: String? = null,
    @SerialName("todo_status") val todoStatus: TaskStatus? = null,
    /** The chat thread this run reports into. */
    @SerialName("conversation_id") val conversationId: String? = null,
    @SerialName("task_type") val taskType: String,
    val instruction: String,
    @SerialName("instruction_snapshot") val instructionSnapshot: String,
    val attempt: Int,
    val provider: String,
    val model: String? = null,
    @SerialName("host_id") val hostId: String? = null,
    @SerialName("workspace_id") val workspaceId: String? = null,
    @SerialName("external_run_id") val externalRunId: String? = null,
    val status: AgentRunStatus,
    val progress: Int = 0,
    @SerialName("progress_message") val progressMessage: String? = null,
    @SerialName("result_summary") val resultSummary: String? = null,
    /** Full provider output; populated only by GET /api/runs/{id}. */
    val result: String? = null,
    val error: String? = null,
    val usage: JsonObject? = null,
    @SerialName("is_adopted") val isAdopted: Boolean = false,
    @SerialName("created_at") val createdAt: String,
    @SerialName("started_at") val startedAt: String? = null,
    @SerialName("heartbeat_at") val heartbeatAt: String? = null,
    @SerialName("completed_at") val completedAt: String? = null,
    @SerialName("cancel_requested_at") val cancelRequestedAt: String? = null,
    @SerialName("updated_at") val updatedAt: String,
) {
    val displayTitle: String
        get() = todoTitle?.takeIf { it.isNotBlank() }
            ?: instructionSnapshot.lineSequence().firstOrNull { it.isNotBlank() }
            ?: "Agent run"

    val canCancel: Boolean
        get() = status.isExecuting || status == AgentRunStatus.WAITING_INPUT

    val wasUnsuccessful: Boolean
        get() = status == AgentRunStatus.FAILED ||
            status == AgentRunStatus.CANCELLED ||
            (status == AgentRunStatus.COMPLETED && !isAdopted)

    val canRetry: Boolean
        get() = wasUnsuccessful && (todoId == null || todoStatus == TaskStatus.IN_PROGRESS)
}

/** An ordered event in the execution log for an agent run. */
@Serializable
data class AgentRunEvent(
    val id: String,
    @SerialName("run_id") val runId: String,
    val sequence: Int,
    @SerialName("event_type") val eventType: String,
    val message: String? = null,
    val progress: Int? = null,
    val payload: JsonObject? = null,
    @SerialName("created_at") val createdAt: String,
)

@Serializable
data class AgentRunRetryRequest(
    val provider: String? = null,
    val model: String? = null,
    @SerialName("follow_up_instruction") val followUpInstruction: String? = null,
)

@Serializable
data class AgentRunResumeRequest(
    @SerialName("follow_up_instruction") val followUpInstruction: String,
)

@Serializable
data class AgentRunPermissionRequest(
    val decision: String,
)
