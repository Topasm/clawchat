package com.clawchat.android

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.data.repository.TodoRepository
import com.clawchat.android.core.notification.ReminderNotificationHelper
import com.clawchat.android.core.sync.SyncManager
import kotlinx.coroutines.launch
import androidx.lifecycle.lifecycleScope
import com.clawchat.android.navigation.ClawChatNavGraph
import com.clawchat.android.ui.theme.ClawChatTheme
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject lateinit var sessionStore: SessionStore
    @Inject lateinit var syncManager: SyncManager
    @Inject lateinit var todoRepository: TodoRepository

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handleShareIntent(intent)

        setContent {
            val isLoggedIn by sessionStore.isLoggedIn.collectAsState(initial = false)
            val onboardingSkipped by sessionStore.onboardingSkipped.collectAsState(initial = false)
            val accentColor by sessionStore.accentColor.collectAsState(initial = "system")

            val context = LocalContext.current

            LaunchedEffect(isLoggedIn) {
                if (isLoggedIn) {
                    syncManager.start()
                } else {
                    syncManager.stop()
                }
            }

            // Show notifications for reminders received via WebSocket
            LaunchedEffect(Unit) {
                syncManager.reminder.collect { reminder ->
                    ReminderNotificationHelper.showReminderNotification(
                        context = context,
                        reminderType = reminder.reminderType,
                        itemId = reminder.itemId,
                        title = reminder.title,
                        message = reminder.message,
                    )
                }
            }

            // Show notifications for nudges received via WebSocket
            LaunchedEffect(Unit) {
                syncManager.nudge.collect { nudge ->
                    ReminderNotificationHelper.showReminderNotification(
                        context = context,
                        reminderType = "nudge",
                        itemId = nudge.todoId ?: "",
                        title = nudge.title,
                        message = nudge.message,
                    )
                }
            }

            // Show toast for weekly review received via WebSocket
            LaunchedEffect(Unit) {
                syncManager.weeklyReview.collect { review ->
                    Toast.makeText(context, "Weekly review is ready!", Toast.LENGTH_LONG).show()
                }
            }

            ClawChatTheme(accentColorKey = accentColor) {
                ClawChatNavGraph(isLoggedIn = isLoggedIn, onboardingSkipped = onboardingSkipped)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleShareIntent(intent)
    }

    private fun handleShareIntent(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND || intent.type != "text/plain") return
        val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return

        lifecycleScope.launch {
            val result = todoRepository.createTodo(
                TodoCreate(
                    title = sharedText.take(200),
                    source = "share_sheet",
                    inboxState = "classifying",
                )
            )
            when (result) {
                is com.clawchat.android.core.network.ApiResult.Success ->
                    Toast.makeText(this@MainActivity, "Saved to inbox", Toast.LENGTH_SHORT).show()
                is com.clawchat.android.core.network.ApiResult.Error ->
                    Toast.makeText(this@MainActivity, "Failed to save", Toast.LENGTH_SHORT).show()
                is com.clawchat.android.core.network.ApiResult.Loading -> {}
            }
        }
    }
}
