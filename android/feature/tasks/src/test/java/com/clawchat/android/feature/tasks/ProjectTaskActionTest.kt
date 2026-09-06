package com.clawchat.android.feature.tasks

import com.clawchat.android.core.data.model.*
import org.junit.Assert.assertEquals
import org.junit.Test

class ProjectTaskActionTest {
    private val ready = ProjectNode("task", "Task", scopeRole = "descendant", executionState = "ready", isReady = true)

    @Test fun `only known ready leaf offers run`() {
        assertEquals(ProjectTaskAction.RUN, projectTaskAction(ready, null, true))
        assertEquals(ProjectTaskAction.DETAILS, projectTaskAction(ready, null, false))
        assertEquals(ProjectTaskAction.DETAILS, projectTaskAction(ready.copy(isContainer = true), null, true))
    }

    @Test fun `active execution overrides stale readiness`() {
        for (status in listOf(AgentRunStatus.QUEUED, AgentRunStatus.STARTING, AgentRunStatus.RUNNING)) {
            assertEquals(ProjectTaskAction.PROGRESS, projectTaskAction(ready, ProjectTaskRun("task", "run", status), true))
        }
        assertEquals(ProjectTaskAction.INPUT, projectTaskAction(ready, ProjectTaskRun("task", "run", AgentRunStatus.WAITING_INPUT), true))
        assertEquals(ProjectTaskAction.REVIEW, projectTaskAction(ready, ProjectTaskRun("task", "run", AgentRunStatus.WAITING_REVIEW), true))
    }

    @Test fun `missing thread identity cannot trigger another execution`() {
        assertEquals(ProjectTaskAction.DETAILS, projectTaskAction(ready, ProjectTaskRun("task", null, AgentRunStatus.RUNNING), true))
    }

    @Test fun `completed blocked and human work open task detail`() {
        for (status in listOf("completed", "cancelled", "blocked", "in_progress")) {
            assertEquals(ProjectTaskAction.DETAILS, projectTaskAction(ready.copy(executionState = status, isReady = false), null, true))
        }
    }
}
