package com.clawchat.android.core.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class InboxReviewChoice(
    @SerialName("project_id") val projectId: String?,
    @SerialName("parent_id") val parentId: String?,
)

@Serializable
data class InboxReviewUpdate(
    val deferred: Boolean? = null,
    @SerialName("exclude_deadline") val excludeDeadline: Boolean? = null,
    val choice: InboxReviewChoice? = null,
    @SerialName("expected_graph_revision") val revision: Long? = null,
)

@Serializable
data class InboxReviewItem(
    @SerialName("task_id") val taskId: String,
    val deferred: Boolean = false,
    @SerialName("exclude_deadline") val excludeDeadline: Boolean = false,
    val choice: InboxReviewChoice? = null,
    @SerialName("choice_revision") val choiceRevision: Long? = null,
)

@Serializable
data class InboxReviewState(val items: List<InboxReviewItem> = emptyList())

@Serializable
data class InboxGraph(
    @SerialName("graph_revision") val revision: Long,
    val nodes: List<ProjectNode> = emptyList(),
)

@Serializable
data class InboxTriageRequest(
    @SerialName("todo_ids") val ids: List<String>,
    @SerialName("expected_graph_revision") val revision: Long,
    val timezone: String = "UTC",
)

@Serializable
data class InboxTriageSuggestion(
    @SerialName("task_id") val taskId: String,
    @SerialName("project_id") val projectId: String,
    @SerialName("parent_id") val parentId: String? = null,
    @SerialName("proposed_parent_key") val proposedParentKey: String? = null,
    val reason: String,
)

@Serializable
data class InboxTriagePreview(
    @SerialName("base_graph_revision") val revision: Long,
    val suggestions: List<InboxTriageSuggestion>,
    @SerialName("unassigned_task_ids") val unassignedIds: List<String> = emptyList(),
    val deadlines: List<InboxDeadlineSuggestion> = emptyList(),
)

@Serializable
data class InboxDeadlineSuggestion(
    @SerialName("task_id") val taskId: String,
    @SerialName("due_date") val dueDate: String,
    @SerialName("local_date") val localDate: String,
    val timezone: String,
    @SerialName("source_text") val sourceText: String,
    @SerialName("is_past") val isPast: Boolean,
)

@Serializable
data class InboxPlacementRequest(
    // Required nullable fields: default Retrofit Json must encode explicit null destinations.
    @SerialName("project_id") val projectId: String?,
    @SerialName("parent_id") val parentId: String?,
    @SerialName("inbox_state") val inboxState: String,
    @SerialName("expected_graph_revision") val revision: Long,
    @SerialName("due_date") val dueDate: String? = null,
)

@Serializable
data class InboxPlacementResult(
    val todo: Todo,
    @SerialName("graph_revision") val revision: Long,
    @SerialName("change_set_id") val changeSetId: String,
)
