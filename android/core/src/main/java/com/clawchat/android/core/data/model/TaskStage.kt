package com.clawchat.android.core.data.model

/**
 * The five steps a task walks through, as the user sees them.
 *
 * The server keeps eight run states, eight plan states and five review
 * states. None of those are shown as-is: every screen that says where a task
 * is (a list row, the task page, a run card) maps them through this one table
 * so the same task reads the same everywhere. It mirrors the web's
 * `src/app/utils/taskStage.ts`; change both together.
 */
enum class TaskStage { CAPTURE, PLAN, RUN, REVIEW, DONE }

/** Something wrong on top of the current step, shown as a badge on it. */
enum class TaskStageException { NEEDS_INPUT, FAILED }

data class TaskStageState(
    val stage: TaskStage,
    val exception: TaskStageException? = null,
    /** A closed task that was dropped rather than finished. */
    val cancelled: Boolean = false,
)

private val ACTIVE_PLAN = setOf("generating", "draft", "stale", "applying")
private val PLANNING_INBOX = setOf("questioning", "planning", "plan_ready")

/**
 * Where a task is, most urgent fact first: a closed task is done; an agent
 * waiting on the user or a result waiting for review comes next; then live
 * work, a failure, planning, and only then the plain task status.
 *
 * [planStatus] and [inboxState] are the server's wire values.
 * [hasSubtasks] means an applied plan is being worked through.
 */
fun taskStage(
    taskStatus: TaskStatus? = null,
    inboxState: String? = null,
    planStatus: String? = null,
    runStatus: AgentRunStatus? = null,
    pendingReviewCount: Int = 0,
    hasSubtasks: Boolean = false,
): TaskStageState {
    if (taskStatus == TaskStatus.COMPLETED) return TaskStageState(TaskStage.DONE)
    if (taskStatus == TaskStatus.CANCELLED) return TaskStageState(TaskStage.DONE, cancelled = true)
    when (runStatus) {
        AgentRunStatus.WAITING_INPUT -> return TaskStageState(TaskStage.RUN, TaskStageException.NEEDS_INPUT)
        AgentRunStatus.WAITING_REVIEW -> return TaskStageState(TaskStage.REVIEW)
        else -> Unit
    }
    if (pendingReviewCount > 0) return TaskStageState(TaskStage.REVIEW)
    when (runStatus) {
        AgentRunStatus.QUEUED, AgentRunStatus.STARTING, AgentRunStatus.RUNNING ->
            return TaskStageState(TaskStage.RUN)
        AgentRunStatus.FAILED -> return TaskStageState(TaskStage.RUN, TaskStageException.FAILED)
        else -> Unit
    }
    if (planStatus in ACTIVE_PLAN) return TaskStageState(TaskStage.PLAN)
    if (planStatus == "failed") return TaskStageState(TaskStage.PLAN, TaskStageException.FAILED)
    if (inboxState in PLANNING_INBOX) {
        return TaskStageState(
            TaskStage.PLAN,
            if (inboxState == "questioning") TaskStageException.NEEDS_INPUT else null,
        )
    }
    if (inboxState == "error") return TaskStageState(TaskStage.CAPTURE, TaskStageException.FAILED)
    if (taskStatus == TaskStatus.IN_PROGRESS || hasSubtasks || planStatus == "applied") {
        return TaskStageState(TaskStage.RUN)
    }
    return TaskStageState(TaskStage.CAPTURE)
}

/**
 * Where one run attempt got to. A finished run whose result was not adopted
 * stopped at review and failed there: retrying is what is left to do.
 */
fun runStage(status: AgentRunStatus, isAdopted: Boolean): TaskStageState = when (status) {
    AgentRunStatus.CANCELLED -> TaskStageState(TaskStage.RUN, cancelled = true)
    AgentRunStatus.COMPLETED -> if (isAdopted) {
        TaskStageState(TaskStage.DONE)
    } else {
        TaskStageState(TaskStage.REVIEW, TaskStageException.FAILED)
    }
    else -> taskStage(runStatus = status)
}

val AgentRun.stage: TaskStageState get() = runStage(status, isAdopted)

private val AGENT_NAMES = mapOf(
    "claude_code" to "Claude",
    "codex" to "Codex",
    "codex_cli" to "Codex",
    "opencode" to "OpenCode",
    "openclaw" to "OpenClaw",
    "paseo" to "Paseo",
)

/** The agent behind a run, by the name people know it by; null when there is none. */
fun agentName(provider: String?): String? =
    provider?.takeIf { it.isNotBlank() }?.let { AGENT_NAMES[it] ?: it }
