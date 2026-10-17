package com.clawchat.android.notification

import androidx.annotation.StringRes
import com.clawchat.android.R
import com.clawchat.android.core.notification.ReminderNotificationHelper

/**
 * What a run's notification says, read from a `run_state` push.
 *
 * The header names the state ("실행 중", "답 필요", "검토 대기"), the title is
 * what the user would recognise (the task, or the agent's question), and the
 * line under it is the one thing worth knowing next: the machine and step, how
 * to answer, or how risky the result is.
 */
internal data class RunNotice(
    val subText: String,
    val title: String,
    val text: String,
    val bigText: String? = null,
    val progress: Int? = null,
    val startedAtMillis: Long? = null,
    val ongoing: Boolean = false,
    val offerApprove: Boolean = false,
    val deliveryKey: String,
    /** A running run's notice is updated in place, so the ledger must not drop the update. */
    val deduplicate: Boolean = true,
)

internal fun interface RunNoticeStrings {
    fun get(@StringRes id: Int, vararg args: Any): String
}

internal fun runNotice(data: Map<String, String>, strings: RunNoticeStrings): RunNotice? {
    val runId = data["run_id"] ?: return null
    val status = data["status"] ?: return null
    val task = data["title"].nonBlank() ?: strings.get(R.string.push_run_untitled)
    val detail = data["detail"].nonBlank()
    val deliveryKey = "run:$runId:${data["push_key"].nonBlank() ?: status}"
    return when (status) {
        "running" -> {
            val step = data["step"]?.toIntOrNull()
            val stepCount = data["step_count"]?.toIntOrNull()
            val stepLabel = if (step != null && stepCount != null && stepCount > 1) {
                strings.get(R.string.push_run_step, step, stepCount)
            } else {
                null
            }
            RunNotice(
                subText = strings.get(R.string.push_run_state_running),
                title = task,
                text = listOfNotNull(data["host_label"].nonBlank(), stepLabel).joinToString(" · "),
                progress = data["progress"]?.toIntOrNull()
                    ?: ReminderNotificationHelper.PROGRESS_INDETERMINATE,
                startedAtMillis = data["started_at_ms"]?.toLongOrNull(),
                ongoing = true,
                deliveryKey = deliveryKey,
                deduplicate = false,
            )
        }
        "waiting_input" -> RunNotice(
            subText = strings.get(
                if (data["reminder"] == "1") {
                    R.string.push_run_state_input_reminder
                } else {
                    R.string.push_run_state_input
                },
            ),
            // The question is what the user answers, so it leads.
            title = detail ?: task,
            text = strings.get(R.string.push_run_tap_to_answer, task),
            bigText = detail?.let { "$it\n${strings.get(R.string.push_run_tap_to_answer, task)}" },
            deliveryKey = deliveryKey,
        )
        "waiting_review" -> {
            val risk = strings.get(
                when (data["risk_level"]) {
                    "low" -> R.string.push_run_risk_low
                    "medium" -> R.string.push_run_risk_medium
                    "high" -> R.string.push_run_risk_high
                    else -> R.string.push_run_risk_unknown
                },
            )
            RunNotice(
                subText = strings.get(R.string.push_run_state_review),
                title = task,
                text = risk,
                bigText = detail?.let { "$risk\n$it" },
                // Only a low-risk result gets a button; everything else is opened and read.
                offerApprove = data["risk_level"] == "low" && data["review_id"].nonBlank() != null,
                deliveryKey = deliveryKey,
            )
        }
        "failed" -> RunNotice(
            subText = strings.get(R.string.push_run_state_failed),
            title = task,
            text = detail.orEmpty(),
            bigText = detail,
            deliveryKey = deliveryKey,
        )
        "completed" -> RunNotice(
            subText = strings.get(R.string.push_run_state_completed),
            title = task,
            text = data["host_label"].nonBlank().orEmpty(),
            deliveryKey = deliveryKey,
        )
        else -> null
    }
}

private fun String?.nonBlank(): String? = this?.takeIf(String::isNotBlank)
