package com.clawchat.android.feature.progress

import com.clawchat.android.core.data.model.AgentRun
import com.clawchat.android.core.data.model.AgentRunStatus
import com.clawchat.android.core.data.model.ReviewItem
import com.clawchat.android.core.data.model.ReviewRiskLevel
import com.clawchat.android.core.data.model.ReviewStatus
import com.clawchat.android.core.data.model.ReviewSubjectType
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NowModelsTest {

    @Test
    fun `todo next actions become user-facing verbs and wait states collapse`() {
        val content = buildNowContent(
            todos = listOf(
                todo("question", "questioning", nextAction = "answer"),
                todo("plan", "plan_ready", nextAction = "review"),
                todo("capture", "captured", nextAction = "organize"),
                todo("error", "error", nextAction = "retry"),
                todo("classifying", "classifying", nextAction = "wait"),
                todo("planning", "planning", nextAction = "wait"),
                todo("ordinary", "none"),
                todo("done", "error", status = TaskStatus.COMPLETED),
            ),
            reviews = emptyList(),
            runs = emptyList(),
        )

        assertEquals(
            listOf(NowAction.ANSWER, NowAction.APPROVE, NowAction.RETRY, NowAction.FILE),
            content.attentionItems.map(NowItem::action),
        )
        assertEquals(2, content.processingCount)
    }

    @Test
    fun `questioning todo is actionable only when questions are present`() {
        val withQuestions = todo("with", "questioning", nextAction = "answer").copy(
            clarificationQuestions = listOf("When is it due?", "Who should receive it?"),
        )
        val withoutQuestions = todo("without", "questioning", nextAction = "answer")

        val items = buildNowContent(
            todos = listOf(withQuestions, withoutQuestions),
            reviews = emptyList(),
            runs = emptyList(),
        ).attentionItems.associateBy(NowItem::sourceId)

        assertTrue(items.getValue("with").canHandleOnDevice)
        assertEquals(
            listOf(
                NowQuestion(0, "When is it due?"),
                NowQuestion(1, "Who should receive it?"),
            ),
            items.getValue("with").questions,
        )
        assertFalse(items.getValue("without").canHandleOnDevice)
    }

    @Test
    fun `blank questions are hidden without changing server answer indexes`() {
        val item = buildNowContent(
            todos = listOf(
                todo("question", "questioning", nextAction = "answer").copy(
                    clarificationQuestions = listOf("First?", "", "Third?"),
                ),
            ),
            reviews = emptyList(),
            runs = emptyList(),
        ).attentionItems.single()

        assertEquals(
            listOf(NowQuestion(0, "First?"), NowQuestion(2, "Third?")),
            item.questions,
        )
        assertEquals(
            mapOf("0" to "First answer", "2" to "Third answer"),
            answersByOriginalIndex(item.questions, listOf("First answer", "Third answer")),
        )
    }

    @Test
    fun `review items replace matching plan todos and waiting review runs`() {
        val content = buildNowContent(
            todos = listOf(todo("todo-plan", "plan_ready")),
            reviews = listOf(
                review(
                    id = "plan-review",
                    subjectType = ReviewSubjectType.PLAN_PROPOSAL,
                    subjectId = "proposal-1",
                    todoId = "todo-plan",
                ),
                review(
                    id = "run-review",
                    subjectType = ReviewSubjectType.AGENT_RUN,
                    subjectId = "run-1",
                ),
            ),
            runs = listOf(run("run-1", AgentRunStatus.WAITING_REVIEW)),
        )

        assertEquals(
            listOf("review:plan-review", "review:run-review"),
            content.attentionItems.map(NowItem::stableId),
        )
    }

    @Test
    fun `run input and retryable failures map to actions`() {
        val content = buildNowContent(
            todos = emptyList(),
            reviews = emptyList(),
            runs = listOf(
                run("input", AgentRunStatus.WAITING_INPUT),
                run("failed", AgentRunStatus.FAILED),
                run("cancelled", AgentRunStatus.CANCELLED),
                run("running", AgentRunStatus.RUNNING),
            ),
        )

        assertEquals(
            listOf(NowAction.ANSWER, NowAction.RETRY),
            content.attentionItems.map(NowItem::action),
        )
        assertTrue(content.attentionItems.first().canHandleOnDevice)
    }

    @Test
    fun `unsupported review keeps approve verb with host fallback`() {
        val review = review(
            id = "artifact-review",
            subjectType = ReviewSubjectType.ARTIFACT_REVISION,
            subjectId = "revision-1",
            href = "/projects/project-1?section=artifacts",
        )

        val item = buildNowContent(emptyList(), listOf(review), emptyList()).attentionItems.single()

        assertEquals(NowAction.APPROVE, item.action)
        assertFalse(item.canHandleOnDevice)
        assertEquals(review.subjectHref, item.hostHref)
    }

    @Test
    fun `supported review still opens authoritative detail before approval`() {
        val item = buildNowContent(
            emptyList(),
            listOf(review("run-review", subjectType = ReviewSubjectType.AGENT_RUN)),
            emptyList(),
        ).attentionItems.single()

        assertEquals(NowAction.APPROVE, item.action)
        assertFalse(item.canHandleOnDevice)
    }

    @Test
    fun `older failed attempt disappears after a newer attempt starts`() {
        val content = buildNowContent(
            todos = emptyList(),
            reviews = emptyList(),
            runs = listOf(
                run("failed-attempt", AgentRunStatus.FAILED, agentTaskId = "same-task", attempt = 1),
                run("new-attempt", AgentRunStatus.RUNNING, agentTaskId = "same-task", attempt = 2),
            ),
        )

        assertTrue(content.attentionItems.isEmpty())
    }

    @Test
    fun `high risk approvals sort before lower risk approvals`() {
        val content = buildNowContent(
            todos = emptyList(),
            reviews = listOf(
                review("low", risk = ReviewRiskLevel.LOW),
                review("high", risk = ReviewRiskLevel.HIGH),
                review("medium", risk = ReviewRiskLevel.MEDIUM),
            ),
            runs = emptyList(),
        )

        assertEquals(
            listOf("review:high", "review:medium", "review:low"),
            content.attentionItems.map(NowItem::stableId),
        )
    }

    @Test
    fun `non-pending reviews do not create attention rows`() {
        val content = buildNowContent(
            todos = emptyList(),
            reviews = listOf(review("approved", status = ReviewStatus.APPROVED)),
            runs = emptyList(),
        )

        assertTrue(content.attentionItems.isEmpty())
    }

    private fun todo(
        id: String,
        inboxState: String,
        nextAction: String? = null,
        status: TaskStatus = TaskStatus.PENDING,
    ) = Todo(
        id = id,
        title = "Task $id",
        status = status,
        inboxState = inboxState,
        nextAction = nextAction,
        updatedAt = "2026-09-01T00:00:00Z",
    )

    private fun review(
        id: String,
        subjectType: ReviewSubjectType = ReviewSubjectType.AGENT_RUN,
        subjectId: String = "subject-$id",
        todoId: String? = null,
        href: String? = null,
        risk: ReviewRiskLevel = ReviewRiskLevel.MEDIUM,
        status: ReviewStatus = ReviewStatus.PENDING,
    ) = ReviewItem(
        id = id,
        subjectType = subjectType,
        subjectId = subjectId,
        subjectTitle = "Review $id",
        subjectHref = href,
        status = status,
        summary = "Review summary",
        riskLevel = risk,
        requestedAt = "2026-09-01T00:00:00Z",
        metadata = buildJsonObject {
            todoId?.let { put("todo_id", it) }
        },
    )

    private fun run(
        id: String,
        status: AgentRunStatus,
        agentTaskId: String = "agent-$id",
        attempt: Int = 1,
    ) = AgentRun(
        id = id,
        agentTaskId = agentTaskId,
        todoId = "todo-$id",
        todoTitle = "Run $id",
        todoStatus = TaskStatus.IN_PROGRESS,
        taskType = "general",
        instruction = "Do work",
        instructionSnapshot = "Do work",
        attempt = attempt,
        provider = "test",
        status = status,
        createdAt = "2026-09-01T00:00:00Z",
        updatedAt = "2026-09-01T00:00:00Z",
    )
}
