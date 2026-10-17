package com.clawchat.android.core.notification

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.model.ReviewDecision
import com.clawchat.android.core.data.repository.ReviewRepository
import com.clawchat.android.core.network.ApiResult
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Approves a low-risk agent result straight from its notification.
 *
 * The server only marks a result low risk when the run could not have changed
 * anything (prose-only skills, no tool call), and the push carries that mark;
 * every other result has to be opened. The notification stays if the request
 * fails, so the action can be tried again.
 */
@AndroidEntryPoint
class ReviewActionReceiver : BroadcastReceiver() {

    @Inject lateinit var reviewRepository: ReviewRepository
    @Inject lateinit var sessionStore: SessionStore

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != ACTION_APPROVE) return
        val reviewId = intent.getStringExtra(EXTRA_REVIEW_ID) ?: return
        val expectedWorkspaceKey = intent.getStringExtra(
            ReminderNotificationHelper.EXTRA_WORKSPACE_KEY,
        ) ?: return
        val notificationId = intent.getIntExtra(ReminderNotificationHelper.EXTRA_NOTIFICATION_ID, 0)
        val pendingResult = goAsync()
        scope.launch {
            try {
                val currentWorkspaceKey = sessionStore.runtimeState.first().workspaceKey
                if (!workspaceActionIsCurrent(expectedWorkspaceKey, currentWorkspaceKey)) {
                    return@launch
                }
                val result = reviewRepository.decideById(reviewId, ReviewDecision.APPROVED)
                if (
                    result is ApiResult.Success &&
                    sessionStore.runtimeState.first().workspaceKey == expectedWorkspaceKey
                ) {
                    ReminderNotificationHelper.dismissReminderNotification(context, notificationId)
                }
            } catch (_: Exception) {
                // Keep the notification so the approval can be retried.
            } finally {
                pendingResult.finish()
            }
        }
    }

    companion object {
        const val ACTION_APPROVE = "com.clawchat.android.ACTION_APPROVE_REVIEW"
        const val EXTRA_REVIEW_ID = "review_id"
    }
}
