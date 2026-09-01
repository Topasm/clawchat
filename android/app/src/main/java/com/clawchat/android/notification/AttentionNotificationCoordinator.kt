package com.clawchat.android.notification

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.core.app.NotificationCompat
import com.clawchat.android.MainActivity
import com.clawchat.android.R
import com.clawchat.android.core.data.AppRuntimeState
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.repository.AgentRunRepository
import com.clawchat.android.core.data.repository.ReviewRepository
import com.clawchat.android.core.data.repository.TodoRepository
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.notification.NotificationPermission
import com.clawchat.android.core.notification.ReminderNotificationHelper
import com.clawchat.android.feature.progress.NowAction
import com.clawchat.android.feature.progress.NowItem
import com.clawchat.android.feature.progress.buildNowContent
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.supervisorScope

data class AttentionBadgeState(
    val workspaceKey: String? = null,
    val count: Int = 0,
)

@Singleton
class AttentionNotificationCoordinator @Inject constructor(
    @ApplicationContext private val context: Context,
    private val todoRepository: TodoRepository,
    private val reviewRepository: ReviewRepository,
    private val agentRunRepository: AgentRunRepository,
    private val sessionStore: SessionStore,
) {
    private val _badgeState = MutableStateFlow(AttentionBadgeState())
    val badgeState: StateFlow<AttentionBadgeState> = _badgeState.asStateFlow()

    /** Refresh only from a complete snapshot; a partial outage must not clear a valid badge. */
    suspend fun refresh(workspaceKey: String): Boolean = supervisorScope {
        if (workspaceKey.isBlank()) return@supervisorScope false
        val todos = async { todoRepository.listTodos(mapOf("limit" to "200")) }
        val reviews = async { reviewRepository.listPending() }
        val runs = async { agentRunRepository.listRuns(limit = 100) }
        val todoResult = todos.await()
        val reviewResult = reviews.await()
        val runResult = runs.await()
        if (
            todoResult !is ApiResult.Success ||
            reviewResult !is ApiResult.Success ||
            runResult !is ApiResult.Success
        ) {
            return@supervisorScope false
        }
        val runtimeState = sessionStore.runtimeState.first()
        if (!isActiveServerWorkspace(runtimeState, workspaceKey)) {
            return@supervisorScope false
        }

        val items = buildNowContent(
            todos = todoResult.data.items,
            reviews = reviewResult.data,
            runs = runResult.data,
        ).attentionItems.filter(::shouldNotifyForAttention)
        _badgeState.value = AttentionBadgeState(workspaceKey, items.size)
        AttentionNotificationHelper.update(context, workspaceKey, items)
        true
    }

    fun clearOtherWorkspaces(workspaceKey: String?) {
        if (_badgeState.value.workspaceKey != workspaceKey) {
            _badgeState.value = AttentionBadgeState(workspaceKey, 0)
        }
        AttentionNotificationHelper.cancelOtherWorkspaceNotifications(context, workspaceKey)
    }
}

internal fun isActiveServerWorkspace(
    runtimeState: AppRuntimeState,
    workspaceKey: String,
): Boolean = runtimeState.mode == WorkspaceMode.SERVER &&
    runtimeState.activeSession != null &&
    runtimeState.workspaceKey == workspaceKey

internal fun shouldNotifyForAttention(item: NowItem): Boolean = item.action in setOf(
    NowAction.ANSWER,
    NowAction.APPROVE,
    NowAction.RETRY,
)

object AttentionNotificationHelper {
    private const val CHANNEL_ID = "clawchat_attention"
    private const val PREFERENCES = "clawchat_attention_delivery"
    private const val EXTRA_ATTENTION_SIGNATURES = "attention_signatures"
    private const val NOTIFICATION_TAG = "clawchat_attention"

    fun createChannel(context: Context) {
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                context.getString(R.string.notification_attention_channel),
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description = context.getString(R.string.notification_attention_channel_description)
                setShowBadge(true)
            },
        )
    }

    fun update(context: Context, workspaceKey: String, items: List<NowItem>) {
        if (workspaceKey.isBlank()) return
        val manager = context.getSystemService(NotificationManager::class.java)
        val notificationId = notificationId(workspaceKey)
        val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        val key = preferenceKey(workspaceKey)
        val previous = preferences.getStringSet(key, emptySet()).orEmpty().toSet()
        val current = items.mapTo(linkedSetOf()) { "${it.stableId}:${it.action.name}" }

        if (current.isEmpty()) {
            preferences.edit().putStringSet(key, current).apply()
            manager.cancel(NOTIFICATION_TAG, notificationId)
            return
        }
        if (!NotificationPermission.isGranted(context)) return

        val isActive = manager.activeNotifications.any {
            it.tag == NOTIFICATION_TAG && it.id == notificationId
        }
        val delivery = attentionDelivery(previous, current, isActive)
        preferences.edit().putStringSet(key, current).apply()
        if (delivery == AttentionDelivery.NONE) return

        val count = current.size
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(ReminderNotificationHelper.EXTRA_REMINDER_TYPE, "attention")
            putExtra(ReminderNotificationHelper.EXTRA_ITEM_ID, "now")
            putExtra(ReminderNotificationHelper.EXTRA_WORKSPACE_KEY, workspaceKey)
            putExtra(ReminderNotificationHelper.EXTRA_NOTIFICATION_ID, notificationId)
        }
        val contentIntent = PendingIntent.getActivity(
            context,
            notificationId,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(com.clawchat.android.core.R.drawable.ic_stat_clawchat)
            .setContentTitle(context.getString(R.string.notification_attention_title))
            .setContentText(
                context.resources.getQuantityString(
                    R.plurals.notification_attention_count,
                    count,
                    count,
                ),
            )
            .setStyle(
                NotificationCompat.InboxStyle().also { style ->
                    items.take(3).forEach { item ->
                        style.addLine("${item.action.localizedVerb(context)} · ${item.title}")
                    }
                },
            )
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .setOnlyAlertOnce(delivery != AttentionDelivery.ALERT)
            .setSilent(delivery != AttentionDelivery.ALERT)
            .setNumber(count)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setExtras(Bundle().apply {
                putString(ReminderNotificationHelper.EXTRA_WORKSPACE_KEY, workspaceKey)
                putStringArrayList(EXTRA_ATTENTION_SIGNATURES, ArrayList(current))
            })
            .build()
        manager.notify(NOTIFICATION_TAG, notificationId, notification)
    }

    fun cancelOtherWorkspaceNotifications(context: Context, workspaceKey: String?) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.activeNotifications
            .filter { it.tag == NOTIFICATION_TAG }
            .filter {
                it.notification.extras.getString(ReminderNotificationHelper.EXTRA_WORKSPACE_KEY) != workspaceKey
            }
            .forEach { manager.cancel(it.tag, it.id) }
    }

    private fun NowAction.localizedVerb(context: Context): String = context.getString(
        when (this) {
            NowAction.ANSWER -> R.string.notification_attention_answer
            NowAction.APPROVE -> R.string.notification_attention_approve
            NowAction.RETRY -> R.string.notification_attention_retry
            NowAction.FILE -> R.string.notification_attention_file
        },
    )

    private fun preferenceKey(workspaceKey: String): String = "workspace_${workspaceKey.hashCode()}"
    private fun notificationId(workspaceKey: String): Int = "$workspaceKey:attention".hashCode()
}

internal enum class AttentionDelivery {
    NONE,
    SILENT,
    ALERT,
}

internal fun attentionDelivery(
    previous: Set<String>,
    current: Set<String>,
    isNotificationActive: Boolean,
): AttentionDelivery = when {
    (current - previous).isNotEmpty() -> AttentionDelivery.ALERT
    isNotificationActive -> AttentionDelivery.SILENT
    else -> AttentionDelivery.NONE
}
