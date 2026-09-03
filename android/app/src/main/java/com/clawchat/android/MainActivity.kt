package com.clawchat.android

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import android.graphics.Color
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.notification.NotificationPermission
import com.clawchat.android.core.notification.ReminderNotificationHelper
import com.clawchat.android.core.sync.SyncManager
import com.clawchat.android.core.ui.theme.ClawChatTheme
import com.clawchat.android.core.ui.update.AppUpdatePrompt
import com.clawchat.android.core.update.AppUpdateManager
import kotlinx.coroutines.flow.MutableStateFlow
import com.clawchat.android.navigation.ClawChatNavGraph
import com.clawchat.android.navigation.reminderRoute
import com.clawchat.android.notification.AttentionNotificationCoordinator
import com.clawchat.android.share.ShareCaptureCoordinator
import com.clawchat.android.share.ShareCaptureEvent
import com.clawchat.android.share.ShareIntentParseResult
import com.clawchat.android.share.ShareIntentParser
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject lateinit var sessionStore: SessionStore
    @Inject lateinit var syncManager: SyncManager
    @Inject lateinit var updateManager: AppUpdateManager
    @Inject lateinit var shareCaptureCoordinator: ShareCaptureCoordinator
    @Inject lateinit var attentionNotifications: AttentionNotificationCoordinator

    private data class PendingReminderNavigation(
        val route: String,
        val workspaceKey: String,
    )

    /** Workspace-scoped reminder destination, consumed once the graph navigates. */
    private val pendingReminderRoute = MutableStateFlow<PendingReminderNavigation?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Both bars stay fully transparent in either polarity: the default
        // styles paint a scrim chosen from the device's dark-mode setting,
        // which is not necessarily the theme this app resolved. ClawChatTheme
        // owns the icon polarity to match.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        handleShareIntent(intent)
        handleReminderIntent(intent)

        setContent {
            // Null is a real loading state. Waiting for the first atomic
            // DataStore snapshot prevents a persisted local workspace from
            // flashing the onboarding screen during process startup.
            val runtimeState by sessionStore.runtimeState.collectAsStateWithLifecycle(initialValue = null)
            val accentColor by sessionStore.accentColor.collectAsStateWithLifecycle(initialValue = "system")
            val themeMode by sessionStore.themeMode.collectAsStateWithLifecycle(initialValue = "light")

            val context = LocalContext.current
            val weeklyReviewReadyMessage = stringResource(R.string.weekly_review_ready)
            val shareQueuedMessage = stringResource(R.string.share_queued)
            val shareSavedLocallyMessage = stringResource(R.string.share_saved_locally)
            val shareFilesRequireServerMessage = stringResource(R.string.share_files_require_server)
            val shareQueueFullMessage = stringResource(R.string.share_queue_full)
            val shareRejectedMessage = stringResource(R.string.share_rejected)
            val shareMalformedMessage = stringResource(R.string.share_malformed)
            val shareFailedMessage = stringResource(R.string.share_failed)
            val updateState by updateManager.state.collectAsStateWithLifecycle()
            val reminderNavigation by pendingReminderRoute.collectAsStateWithLifecycle()
            val attentionBadge by attentionNotifications.badgeState.collectAsStateWithLifecycle()
            val notificationPermissionRequested by sessionStore
                .notificationPermissionRequested
                .collectAsStateWithLifecycle(initialValue = true)

            val notificationPermissionLauncher = rememberLauncherForActivityResult(
                ActivityResultContracts.RequestPermission(),
            ) { /* The system keeps the answer; a denial is not retried. */ }

            // Local reminders need the same permission as server reminders, so
            // ask once after either workspace mode has been selected.
            LaunchedEffect(runtimeState?.mode, notificationPermissionRequested) {
                if (
                    runtimeState?.mode == null ||
                    runtimeState?.mode == WorkspaceMode.UNCONFIGURED ||
                    notificationPermissionRequested
                ) {
                    return@LaunchedEffect
                }
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

            LaunchedEffect(runtimeState?.workspaceKey, reminderNavigation?.workspaceKey) {
                val workspaceKey = runtimeState?.workspaceKey
                if (reminderNavigation?.workspaceKey != workspaceKey) {
                    pendingReminderRoute.value = null
                }
            }

            // Show toast for weekly review received via WebSocket
            LaunchedEffect(Unit) {
                syncManager.weeklyReview.collect {
                    Toast.makeText(
                        context,
                        weeklyReviewReadyMessage,
                        Toast.LENGTH_LONG,
                    ).show()
                }
            }

            // Channel-backed events survive the small gap between the share
            // intent arriving and Compose installing this collector.
            LaunchedEffect(Unit) {
                shareCaptureCoordinator.events.collect { event ->
                    val (message, duration) = when (event) {
                        ShareCaptureEvent.Queued ->
                            shareQueuedMessage to Toast.LENGTH_SHORT
                        ShareCaptureEvent.SavedLocally ->
                            shareSavedLocallyMessage to Toast.LENGTH_SHORT
                        ShareCaptureEvent.FilesRequireServer ->
                            shareFilesRequireServerMessage to Toast.LENGTH_LONG
                        ShareCaptureEvent.QueueFull ->
                            shareQueueFullMessage to Toast.LENGTH_LONG
                        ShareCaptureEvent.Rejected ->
                            shareRejectedMessage to Toast.LENGTH_LONG
                        ShareCaptureEvent.Malformed ->
                            shareMalformedMessage to Toast.LENGTH_LONG
                        ShareCaptureEvent.Failed ->
                            shareFailedMessage to Toast.LENGTH_LONG
                    }
                    Toast.makeText(context, message, duration).show()
                }
            }

            ClawChatTheme(
                themeModeKey = themeMode,
                accentColorKey = accentColor,
            ) {
                runtimeState?.let { state ->
                    // ViewModels cache workspace-shaped data. Recreate the
                    // graph when its identity changes so local and server UI
                    // state can never bleed across a mode switch.
                    key(state.workspaceKey ?: state.mode.name) {
                        ClawChatNavGraph(
                            isLoggedIn = state.mode == WorkspaceMode.SERVER && state.activeSession != null,
                            onboardingSkipped = state.mode == WorkspaceMode.LOCAL,
                            workspaceMode = state.mode,
                            deepLinkRoute = reminderNavigation
                                ?.takeIf { it.workspaceKey == state.workspaceKey }
                                ?.route,
                            onDeepLinkHandled = { pendingReminderRoute.value = null },
                            attentionCount = attentionBadge.count.takeIf {
                                attentionBadge.workspaceKey == state.workspaceKey
                            } ?: 0,
                        )
                    }
                }
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
        val workspaceKey = intent.getStringExtra(ReminderNotificationHelper.EXTRA_WORKSPACE_KEY)
            ?: return
        val route = reminderRoute(reminderType) ?: return
        if (intent.hasExtra(ReminderNotificationHelper.EXTRA_NOTIFICATION_ID)) {
            val notificationId = intent.getIntExtra(
                ReminderNotificationHelper.EXTRA_NOTIFICATION_ID,
                0,
            )
            ReminderNotificationHelper.dismissReminderNotification(this, notificationId)
        }
        intent.removeExtra(ReminderNotificationHelper.EXTRA_REMINDER_TYPE)
        intent.removeExtra(ReminderNotificationHelper.EXTRA_ITEM_ID)
        intent.removeExtra(ReminderNotificationHelper.EXTRA_WORKSPACE_KEY)
        intent.removeExtra(ReminderNotificationHelper.EXTRA_NOTIFICATION_ID)
        pendingReminderRoute.value = PendingReminderNavigation(
            route = route,
            workspaceKey = workspaceKey,
        )
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
