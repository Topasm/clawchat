package com.clawchat.android.core.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement

/** One item in the server's unified human-review queue. */
@Serializable
data class ReviewItem(
    val id: String,
    @SerialName("project_id") val projectId: String? = null,
    @SerialName("project_title") val projectTitle: String? = null,
    @SerialName("subject_type") val subjectType: ReviewSubjectType = ReviewSubjectType.UNKNOWN,
    @SerialName("subject_id") val subjectId: String,
    @SerialName("subject_title") val subjectTitle: String? = null,
    @SerialName("subject_description") val subjectDescription: String? = null,
    @SerialName("subject_href") val subjectHref: String? = null,
    val status: ReviewStatus = ReviewStatus.PENDING,
    val summary: String,
    @SerialName("risk_level") val riskLevel: ReviewRiskLevel = ReviewRiskLevel.MEDIUM,
    @SerialName("requested_at") val requestedAt: String,
    @SerialName("reviewed_at") val reviewedAt: String? = null,
    @SerialName("review_note") val reviewNote: String? = null,
    val metadata: JsonObject = buildJsonObject {},
) {
    /**
     * Mobile decisions are intentionally narrower than the server contract.
     * Plans and artifacts need their complete source/revision UI before a
     * phone can safely approve them; Agent Runs can load authoritative detail.
     */
    val supportsDecision: Boolean
        get() = subjectType == ReviewSubjectType.AGENT_RUN

    val agentRunApprovalImpact: AgentRunApprovalImpact?
        get() = metadata["approval_impact"]?.let { encoded ->
            runCatching {
                reviewMetadataJson.decodeFromJsonElement<AgentRunApprovalImpact>(encoded)
            }.getOrNull()
        }
}

private val reviewMetadataJson = Json { ignoreUnknownKeys = true }

@Serializable
data class AgentRunApprovalImpact(
    @SerialName("todo_id") val todoId: String? = null,
    @SerialName("graph_revision") val graphRevision: Int,
    @SerialName("newly_ready_tasks") val newlyReadyTasks: List<ReadyTaskReference> = emptyList(),
)

@Serializable
data class ReadyTaskReference(
    val id: String,
    val title: String,
)

@Serializable
enum class ReviewSubjectType {
    @SerialName("plan_proposal") PLAN_PROPOSAL,
    @SerialName("artifact_revision") ARTIFACT_REVISION,
    @SerialName("agent_run") AGENT_RUN,
    @SerialName("code_diff") CODE_DIFF,
    @SerialName("schedule_change") SCHEDULE_CHANGE,
    @SerialName("sync_conflict") SYNC_CONFLICT,
    @SerialName("unknown") UNKNOWN,
}

@Serializable
enum class ReviewStatus {
    @SerialName("pending") PENDING,
    @SerialName("approved") APPROVED,
    @SerialName("changes_requested") CHANGES_REQUESTED,
    @SerialName("rejected") REJECTED,
    @SerialName("expired") EXPIRED,
}

@Serializable
enum class ReviewRiskLevel {
    @SerialName("low") LOW,
    @SerialName("medium") MEDIUM,
    @SerialName("high") HIGH,
}

@Serializable
enum class ReviewDecision {
    @SerialName("approved") APPROVED,
    @SerialName("changes_requested") CHANGES_REQUESTED,
    @SerialName("rejected") REJECTED,
}

@Serializable
data class ReviewDecisionRequest(
    val decision: ReviewDecision,
    val note: String? = null,
)

@Serializable
data class ReviewDecisionResponse(
    val review: ReviewItem,
    val outcome: JsonObject = buildJsonObject {},
)
