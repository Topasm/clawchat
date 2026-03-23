package com.clawchat.android.core.notification

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.clawchat.android.core.data.model.TodoUpdate
import com.clawchat.android.core.data.repository.TodoRepository
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class ReminderActionReceiver : BroadcastReceiver() {

    @Inject lateinit var todoRepository: TodoRepository

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        val itemId = intent.getStringExtra("item_id") ?: return
        val notificationId = intent.getIntExtra("notification_id", 0)

        if (action == ACTION_MARK_DONE) {
            val pendingResult = goAsync()
            scope.launch {
                try {
                    todoRepository.updateTodo(
                        itemId,
                        TodoUpdate(status = "completed"),
                    )
                    // Dismiss the notification
                    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    nm.cancel(notificationId)
                } catch (_: Exception) {
                    // Best effort — if offline, the action silently fails
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
