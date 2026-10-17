package com.clawchat.android.feature.home

import com.clawchat.android.core.data.model.AgentRun
import com.clawchat.android.core.data.model.AgentRunStatus
import com.clawchat.android.core.data.model.ProjectPlan
import com.clawchat.android.core.data.model.ReviewItem
import com.clawchat.android.core.data.model.ReviewStatus
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import org.junit.Assert.assertEquals
import org.junit.Test

class HomeUiStateTest {
    @Test
    fun `check counts pending reviews and runs waiting for an answer, running counts executing runs`() {
        val reviews = listOf(review("rv1", ReviewStatus.PENDING), review("rv2", ReviewStatus.APPROVED))
        val runs = listOf(
            run("r1", AgentRunStatus.WAITING_INPUT),
            run("r2", AgentRunStatus.WAITING_REVIEW),
            run("r3", AgentRunStatus.QUEUED),
            run("r4", AgentRunStatus.RUNNING),
            run("r5", AgentRunStatus.FAILED),
        )
        assertEquals(2 to 2, homeCounts(reviews, runs))
    }

    @Test
    fun `a project ring counts its own tasks, not its root or cancelled ones`() {
        val projects = listOf(ProjectPlan("p1", "Offsite"), ProjectPlan("p2", "Empty"))
        val todos = listOf(
            todo("root", "p1", TaskStatus.PENDING, source = "project_root"),
            todo("t1", "p1", TaskStatus.COMPLETED),
            todo("t2", "p1", TaskStatus.PENDING),
            todo("t3", "p1", TaskStatus.CANCELLED),
            todo("t4", null, TaskStatus.COMPLETED),
        )
        assertEquals(
            listOf(HomeProject("p1", "Offsite", done = 1, total = 2), HomeProject("p2", "Empty")),
            homeProjects(projects, todos),
        )
        assertEquals(0.5f, HomeProject("p1", "Offsite", done = 1, total = 2).fraction)
        assertEquals(0f, HomeProject("p2", "Empty").fraction)
    }
}

private fun review(id: String, status: ReviewStatus) = ReviewItem(
    id = id,
    subjectId = "run_$id",
    status = status,
    summary = "Summary",
    requestedAt = "2026-10-03T08:00:00Z",
)

private fun run(id: String, status: AgentRunStatus) = AgentRun(
    id = id,
    agentTaskId = "task_$id",
    todoId = "todo_$id",
    todoTitle = "Task $id",
    taskType = "research",
    instruction = "Do it",
    instructionSnapshot = "Do it",
    attempt = 1,
    provider = "codex_cli",
    status = status,
    createdAt = "2026-10-03T08:00:00Z",
    updatedAt = "2026-10-03T08:30:00Z",
)

private fun todo(id: String, projectId: String?, status: TaskStatus, source: String? = null) = Todo(
    id = id,
    title = "Task $id",
    projectId = projectId,
    status = status,
    source = source,
)
