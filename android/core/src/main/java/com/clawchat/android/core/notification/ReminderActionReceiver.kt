package com.clawchat.android.core.notification

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.TodoUpdate
import com.clawchat.android.core.data.repository.TodoRepository
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.first
import javax.inject.Inject

@AndroidEntryPoint
class ReminderActionReceiver : BroadcastReceiver() {

    @Inject lateinit var todoRepository: TodoRepository
    @Inject lateinit var sessionStore: SessionStore

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        val itemId = intent.getStringExtra("item_id") ?: return
        val expectedWorkspaceKey = intent.getStringExtra(
            ReminderNotificationHelper.EXTRA_WORKSPACE_KEY,
        ) ?: return
        val notificationId = intent.getIntExtra("notification_id", 0)

        if (action == ACTION_MARK_DONE) {
            val pendingResult = goAsync()
            scope.launch {
                try {
                    val currentWorkspaceKey = sessionStore.runtimeState.first().workspaceKey
                    if (!workspaceActionIsCurrent(expectedWorkspaceKey, currentWorkspaceKey)) {
                        return@launch
                    }
                    val result = todoRepository.updateTodo(
                        itemId,
                        TodoUpdate(status = TaskStatus.COMPLETED),
                        expectedWorkspaceKey = expectedWorkspaceKey,
                    )
                    // Only acknowledge a successful mutation that still
                    // belongs to the workspace that created the action.
                    if (
                        result is com.clawchat.android.core.network.ApiResult.Success &&
                        sessionStore.runtimeState.first().workspaceKey == expectedWorkspaceKey
                    ) {
                        val nm = context.getSystemService(
                            Context.NOTIFICATION_SERVICE,
                        ) as NotificationManager
                        nm.cancel(notificationId)
                    }
                } catch (_: Exception) {
                    // Keep the notification visible so the action can be retried.
                } finally {
                    pendingResult.finish()
                }
            }
        }
    }

    companion object {
        const val ACTION_MARK_DONE = "com.clawchat.android.ACTION_MARK_DONE"
    }
}

internal fun workspaceActionIsCurrent(expected: String?, actual: String?): Boolean =
    !expected.isNullOrBlank() && expected == actual
