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
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.notification.NotificationPermission
import com.clawchat.android.core.notification.ReminderNotificationHelper
import com.clawchat.android.core.sync.SyncManager
import com.clawchat.android.core.ui.update.AppUpdatePrompt
import com.clawchat.android.core.update.AppUpdateManager
import kotlinx.coroutines.flow.MutableStateFlow
import com.clawchat.android.navigation.ClawChatNavGraph
import com.clawchat.android.navigation.reminderRoute
import com.clawchat.android.share.ShareCaptureCoordinator
import com.clawchat.android.share.ShareCaptureEvent
import com.clawchat.android.share.ShareIntentParseResult
import com.clawchat.android.share.ShareIntentParser
import com.clawchat.android.ui.theme.ClawChatTheme
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject lateinit var sessionStore: SessionStore
    @Inject lateinit var syncManager: SyncManager
    @Inject lateinit var updateManager: AppUpdateManager
    @Inject lateinit var shareCaptureCoordinator: ShareCaptureCoordinator

    /** Route a tapped reminder asked for, consumed once the graph navigates. */
    private val pendingReminderRoute = MutableStateFlow<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handleShareIntent(intent)
        handleReminderIntent(intent)

        setContent {
            val isLoggedIn by sessionStore.isLoggedIn.collectAsStateWithLifecycle(initialValue = false)
            val activeSession by sessionStore.activeSession.collectAsStateWithLifecycle(initialValue = null)
            val onboardingSkipped by sessionStore.onboardingSkipped.collectAsStateWithLifecycle(initialValue = false)
            val accentColor by sessionStore.accentColor.collectAsStateWithLifecycle(initialValue = "system")
            val themeMode by sessionStore.themeMode.collectAsStateWithLifecycle(initialValue = "light")

            val context = LocalContext.current
            val updateState by updateManager.state.collectAsStateWithLifecycle()
            val reminderDeepLink by pendingReminderRoute.collectAsStateWithLifecycle()
            val notificationPermissionRequested by sessionStore
                .notificationPermissionRequested
                .collectAsStateWithLifecycle(initialValue = true)

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

            LaunchedEffect(activeSession) {
                // A workspace switch keeps isLoggedIn=true, so lifecycle must
                // follow the complete session identity rather than that flag.
                // This also prevents realtime events from the previous server
                // surviving a direct/paired workspace transition.
                syncManager.stop()
                if (activeSession != null) {
                    syncManager.start()
                    // A share can be captured before login or while the app is
                    // not running. Workspace changes also wake captures that
                    // are pinned to the newly active server.
                    shareCaptureCoordinator.flush()
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
                        deliveryKey = reminder.deliveryKey,
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

            // Channel-backed events survive the small gap between the share
            // intent arriving and Compose installing this collector.
            LaunchedEffect(Unit) {
                shareCaptureCoordinator.events.collect { event ->
                    val (message, duration) = when (event) {
                        ShareCaptureEvent.Queued ->
                            getString(R.string.share_queued) to Toast.LENGTH_SHORT
                        ShareCaptureEvent.QueueFull ->
                            getString(R.string.share_queue_full) to Toast.LENGTH_LONG
                        ShareCaptureEvent.Rejected ->
                            getString(R.string.share_rejected) to Toast.LENGTH_LONG
                        ShareCaptureEvent.Malformed ->
                            getString(R.string.share_malformed) to Toast.LENGTH_LONG
                        ShareCaptureEvent.Failed ->
                            getString(R.string.share_failed) to Toast.LENGTH_LONG
                    }
                    Toast.makeText(context, message, duration).show()
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
        when (val result = ShareIntentParser.parse(intent)) {
            ShareIntentParseResult.NotShare -> return
            ShareIntentParseResult.Malformed -> {
                // Never retry an attacker-controlled malformed Parcelable on
                // recreation. No part of the payload is accepted.
                intent?.action = null
                shareCaptureCoordinator.malformedIntent()
            }
            is ShareIntentParseResult.Accepted -> {
                // Prevent a configuration change from processing the same
                // launch intent twice. URI grants are copied immediately into
                // app-private storage by the coordinator.
                intent?.action = null
                shareCaptureCoordinator.submit(result.payload)
            }
        }
    }
}
