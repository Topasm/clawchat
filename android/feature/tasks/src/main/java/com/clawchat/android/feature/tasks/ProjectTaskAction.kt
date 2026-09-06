package com.clawchat.android.feature.tasks

import com.clawchat.android.core.data.model.AgentRunStatus
import com.clawchat.android.core.data.model.ProjectNode
import com.clawchat.android.core.data.model.ProjectTaskRun

internal enum class ProjectTaskAction { RUN, PROGRESS, INPUT, REVIEW, DETAILS }

internal fun projectTaskAction(node: ProjectNode, run: ProjectTaskRun?, available: Boolean): ProjectTaskAction {
    val action = when (run?.status) {
        AgentRunStatus.QUEUED, AgentRunStatus.STARTING, AgentRunStatus.RUNNING -> ProjectTaskAction.PROGRESS
        AgentRunStatus.WAITING_INPUT -> ProjectTaskAction.INPUT
        AgentRunStatus.WAITING_REVIEW -> ProjectTaskAction.REVIEW
        else -> null
    }
    if (action != null) return if (run?.runId != null) action else ProjectTaskAction.DETAILS
    return if (available && node.isReady && !node.isContainer && node.executionState == "ready") ProjectTaskAction.RUN
        else ProjectTaskAction.DETAILS
}
