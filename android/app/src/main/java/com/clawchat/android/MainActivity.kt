package com.clawchat.android

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.data.repository.TodoRepository
import com.clawchat.android.core.notification.NotificationPermission
import com.clawchat.android.core.notification.ReminderNotificationHelper
import com.clawchat.android.core.sync.SyncManager
import com.clawchat.android.core.ui.update.AppUpdatePrompt
import com.clawchat.android.core.update.AppUpdateManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import androidx.lifecycle.lifecycleScope
import com.clawchat.android.navigation.ClawChatNavGraph
import com.clawchat.android.navigation.reminderRoute
import com.clawchat.android.ui.theme.ClawChatTheme
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject lateinit var sessionStore: SessionStore
    @Inject lateinit var syncManager: SyncManager
    @Inject lateinit var todoRepository: TodoRepository
    @Inject lateinit var updateManager: AppUpdateManager

    /** Route a tapped reminder asked for, consumed once the graph navigates. */
    private val pendingReminderRoute = MutableStateFlow<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handleShareIntent(intent)
        handleReminderIntent(intent)

        setContent {
            val isLoggedIn by sessionStore.isLoggedIn.collectAsState(initial = false)
            val onboardingSkipped by sessionStore.onboardingSkipped.collectAsState(initial = false)
            val accentColor by sessionStore.accentColor.collectAsState(initial = "system")
            val themeMode by sessionStore.themeMode.collectAsState(initial = "light")

            val context = LocalContext.current
            val updateState by updateManager.state.collectAsState()
            val reminderDeepLink by pendingReminderRoute.collectAsState()
            val notificationPermissionRequested by sessionStore
                .notificationPermissionRequested
                .collectAsState(initial = true)

            val notificationPermissionLauncher = rememberLauncherForActivityResult(
                ActivityResultContracts.RequestPermission(),
            ) { /* The system keeps the answer; a denial is not retried. */ }

            // Android 13+ drops every reminder until the user grants this, and
            // the system ignores a second request, so ask exactly once — after
            // the app has a server to receive reminders from.
            LaunchedEffect(isLoggedIn, notificationPermissionRequested) {
                if (!isLoggedIn || notificationPermissionRequested) return@LaunchedEffect
                if (!NotificationPermission.isRuntimePermission()) return@LaunchedEffect
                if (NotificationPermission.isGranted(context)) return@LaunchedEffect
                sessionStore.markNotificationPermissionRequested()
                notificationPermissionLauncher.launch(NotificationPermission.PERMISSION)
            }

            // A published GitHub release is offered once per launch window;
            // the manager throttles the network call and honours the
            // "check automatically" preference.
            LaunchedEffect(Unit) {
                updateManager.refreshPreferences()
                updateManager.checkForUpdateIfDue()
            }

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

            ClawChatTheme(
                themeModeKey = themeMode,
                accentColorKey = accentColor,
            ) {
                ClawChatNavGraph(
                    isLoggedIn = isLoggedIn,
                    onboardingSkipped = onboardingSkipped,
                    deepLinkRoute = reminderDeepLink,
                    onDeepLinkHandled = { pendingReminderRoute.value = null },
                )
                AppUpdatePrompt(
                    state = updateState,
                    onDownload = updateManager::downloadUpdate,
                    onInstall = updateManager::installUpdate,
                    onSkip = updateManager::skipPendingVersion,
                    onDismiss = updateManager::dismissPrompt,
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleShareIntent(intent)
        handleReminderIntent(intent)
    }

    /**
     * A reminder notification carries the item it is about. Route to the screen
     * that shows it, and clear the extras so a configuration change does not
     * navigate a second time.
     */
    private fun handleReminderIntent(intent: Intent?) {
        val reminderType = intent?.getStringExtra(ReminderNotificationHelper.EXTRA_REMINDER_TYPE)
            ?: return
        intent.removeExtra(ReminderNotificationHelper.EXTRA_REMINDER_TYPE)
        intent.removeExtra(ReminderNotificationHelper.EXTRA_ITEM_ID)
        pendingReminderRoute.value = reminderRoute(reminderType)
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
