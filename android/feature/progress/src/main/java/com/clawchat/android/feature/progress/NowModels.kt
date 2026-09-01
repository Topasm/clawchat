package com.clawchat.android.feature.progress

import com.clawchat.android.core.data.model.AgentRun
import com.clawchat.android.core.data.model.AgentRunStatus
import com.clawchat.android.core.data.model.ReviewItem
import com.clawchat.android.core.data.model.ReviewRiskLevel
import com.clawchat.android.core.data.model.ReviewStatus
import com.clawchat.android.core.data.model.ReviewSubjectType
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** A user-facing verb, independent of the server entity that needs attention. */
enum class NowAction {
    ANSWER,
    APPROVE,
    FILE,
    RETRY,
}

enum class NowSource {
    TODO,
    REVIEW,
    AGENT_RUN,
}

/** One normalized row in Now's attention list. */
data class NowItem(
    val stableId: String,
    val source: NowSource,
    val sourceId: String,
    val todoId: String? = null,
    val action: NowAction,
    val title: String,
    val summary: String? = null,
    val updatedAt: String,
    val riskLevel: ReviewRiskLevel? = null,
    val questions: List<NowQuestion> = emptyList(),
    val canHandleOnDevice: Boolean,
    val hostHref: String? = null,
)

data class NowQuestion(
    val originalIndex: Int,
    val text: String,
)

internal fun answersByOriginalIndex(
    questions: List<NowQuestion>,
    answers: List<String>,
): Map<String, String> = questions.mapIndexed { answerIndex, question ->
    question.originalIndex.toString() to answers[answerIndex]
}.toMap()

data class NowContent(
    val attentionItems: List<NowItem>,
    val processingCount: Int,
)

/**
 * Merge the three existing mobile data sources without changing their server contracts.
 * A ReviewItem is authoritative when it represents the same plan or waiting-review run.
 */
fun buildNowContent(
    todos: List<Todo>,
    reviews: List<ReviewItem>,
    runs: List<AgentRun>,
): NowContent {
    val pendingReviews = reviews.filter { it.status == ReviewStatus.PENDING }
    val reviewedTodoIds = pendingReviews
        .asSequence()
        .filter { it.subjectType == ReviewSubjectType.PLAN_PROPOSAL }
        .mapNotNull(ReviewItem::relatedTodoId)
        .toSet()
    val reviewedRunIds = pendingReviews
        .asSequence()
        .filter { it.subjectType == ReviewSubjectType.AGENT_RUN }
        .map(ReviewItem::subjectId)
        .toSet()
    val latestAttemptByAgentTask = runs
        .groupingBy(AgentRun::agentTaskId)
        .fold(Int.MIN_VALUE) { latest, run -> maxOf(latest, run.attempt) }

    val todoItems = todos.mapNotNull { todo ->
        val action = todo.nowAction() ?: return@mapNotNull null
        if (action == NowAction.APPROVE && todo.id in reviewedTodoIds) return@mapNotNull null
        NowItem(
            stableId = "todo:${todo.id}",
            source = NowSource.TODO,
            sourceId = todo.id,
            todoId = todo.id,
            action = action,
            title = todo.title,
            summary = todo.planSummary ?: todo.automationError ?: todo.description,
            updatedAt = todo.updatedAt,
            questions = if (action == NowAction.ANSWER) {
                todo.clarificationQuestions.orEmpty().mapIndexedNotNull { index, question ->
                    question.takeIf(String::isNotBlank)?.let {
                        NowQuestion(originalIndex = index, text = it)
                    }
                }
            } else {
                emptyList()
            },
            canHandleOnDevice = action == NowAction.FILE || action == NowAction.RETRY ||
                (action == NowAction.ANSWER && todo.clarificationQuestions.orEmpty().any(String::isNotBlank)),
        )
    }
    val reviewItems = pendingReviews.map { review ->
        NowItem(
            stableId = "review:${review.id}",
            source = NowSource.REVIEW,
            sourceId = review.id,
            todoId = review.relatedTodoId(),
            action = NowAction.APPROVE,
            title = review.subjectTitle?.takeIf(String::isNotBlank) ?: review.summary,
            summary = review.summary,
            updatedAt = review.requestedAt,
            riskLevel = review.riskLevel,
            // Review detail first loads authoritative evidence and impact. Do not bypass it here.
            canHandleOnDevice = false,
            hostHref = review.subjectHref,
        )
    }
    val runItems = runs.mapNotNull { run ->
        val action = when (run.status) {
            AgentRunStatus.WAITING_INPUT -> NowAction.ANSWER
            AgentRunStatus.WAITING_REVIEW -> {
                if (run.id in reviewedRunIds) return@mapNotNull null
                NowAction.APPROVE
            }
            AgentRunStatus.FAILED -> if (
                run.canRetry && run.attempt == latestAttemptByAgentTask[run.agentTaskId]
            ) {
                NowAction.RETRY
            } else {
                return@mapNotNull null
            }
            else -> return@mapNotNull null
        }
        NowItem(
            stableId = "run:${run.id}",
            source = NowSource.AGENT_RUN,
            sourceId = run.id,
            todoId = run.todoId,
            action = action,
            title = run.displayTitle,
            summary = run.error ?: run.progressMessage ?: run.resultSummary,
            updatedAt = run.updatedAt,
            canHandleOnDevice = action != NowAction.APPROVE,
        )
    }

    return NowContent(
        attentionItems = (todoItems + reviewItems + runItems).sortedWith(nowItemComparator),
        processingCount = todos.count {
            it.status != TaskStatus.COMPLETED &&
                it.status != TaskStatus.CANCELLED &&
                it.inboxState in PROCESSING_INBOX_STATES
        },
    )
}

private fun Todo.nowAction(): NowAction? {
    if (status == TaskStatus.COMPLETED || status == TaskStatus.CANCELLED) return null
    return when (nextAction?.trim()?.lowercase()) {
        "answer" -> NowAction.ANSWER
        "review", "approve" -> NowAction.APPROVE
        "organize", "file" -> NowAction.FILE
        "retry" -> NowAction.RETRY
        "wait" -> null
        null, "" -> when (inboxState) {
            "questioning" -> NowAction.ANSWER
            "plan_ready" -> NowAction.APPROVE
            "captured" -> NowAction.FILE
            "error" -> NowAction.RETRY
            else -> null
        }
        else -> null
    }
}

private fun ReviewItem.relatedTodoId(): String? =
    (metadata["todo_id"] as? JsonPrimitive)?.contentOrNull

private val nowItemComparator = compareBy<NowItem> { it.action.attentionOrder }
    .thenBy { it.riskLevel?.attentionOrder ?: Int.MAX_VALUE }
    .thenByDescending(NowItem::updatedAt)
    .thenBy(NowItem::stableId)

private val NowAction.attentionOrder: Int
    get() = when (this) {
        NowAction.ANSWER -> 0
        NowAction.APPROVE -> 1
        NowAction.RETRY -> 2
        NowAction.FILE -> 3
    }

private val ReviewRiskLevel.attentionOrder: Int
    get() = when (this) {
        ReviewRiskLevel.HIGH -> 0
        ReviewRiskLevel.MEDIUM -> 1
        ReviewRiskLevel.LOW -> 2
    }

private val PROCESSING_INBOX_STATES = setOf("classifying", "planning")
