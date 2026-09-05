package com.clawchat.android.core.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class ChatPlanProposal(
    @SerialName("proposal_id") val id: String,
    @SerialName("todo_id") val todoId: String,
    val status: String,
    @SerialName("base_graph_revision") val revision: Int? = null,
    val summary: String? = null,
    val subtasks: List<ChatPlanStep> = emptyList(),
    val validation: ChatPlanValidation = ChatPlanValidation(),
    val diff: ChatPlanDiff = ChatPlanDiff(),
    @SerialName("suggested_root_due_date") val rootDueDate: String? = null,
    @SerialName("suggested_assignee") val assignee: String? = null,
    @SerialName("suggested_skills") val skills: List<String>? = null,
    @SerialName("suggested_project_title") val projectTitle: String? = null,
    @SerialName("change_set_id") val changeSetId: String? = null,
    @SerialName("can_undo") val canUndo: Boolean? = null,
) {
    val canApply: Boolean get() = status == "draft" && revision != null && validation.errors.isEmpty() && subtasks.isNotEmpty() &&
        diff.rootFields.all { it in setOf("due_date", "assignee", "enabled_skills", "source", "source_id") }
}

@Serializable
data class ChatPlanStep(
    val title: String,
    val description: String? = null,
    val priority: String? = null,
    @SerialName("due_date") val dueDate: String? = null,
    @SerialName("estimated_minutes") val minutes: Int? = null,
    @SerialName("depends_on_indices") val dependencies: List<Int> = emptyList(),
)

@Serializable
data class ChatPlanValidation(val errors: List<ChatPlanIssue> = emptyList(), val warnings: List<ChatPlanIssue> = emptyList())
@Serializable
data class ChatPlanIssue(val code: String, val message: String)
@Serializable
data class ChatPlanDiff(@SerialName("root_update_fields") val rootFields: List<String> = emptyList())
@Serializable
data class ChatPlanApplyRequest(
    @SerialName("proposal_id") val proposalId: String,
    @SerialName("base_graph_revision") val revision: Int,
)
@Serializable
data class ChatPlanApplyResult(
    @SerialName("change_set_id") val changeSetId: String,
    @SerialName("can_undo") val canUndo: Boolean = false,
)
