package com.clawchat.android.widget.quickadd

import android.content.ComponentName
import android.content.Context
import android.os.Build
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.ColorFilter
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.currentState
import androidx.glance.action.actionStartActivity as actionStartActivityByComponent
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity as actionStartActivityByIntent
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.widget.R
import com.clawchat.android.widget.common.WidgetAppearance
import com.clawchat.android.widget.common.WidgetColors
import com.clawchat.android.widget.common.widgetBackground
import com.clawchat.android.widget.di.WidgetEntryPoint
import dagger.hilt.android.EntryPointAccessors
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first

class InboxQuickAddWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val entryPoint = EntryPointAccessors.fromApplication(
            context.applicationContext,
            WidgetEntryPoint::class.java,
        )
        val workspaceMode = entryPoint.sessionStore().runtimeState.first().mode
        val isConfigured = workspaceMode != WorkspaceMode.UNCONFIGURED

        val inboxCount = if (isConfigured) {
            when (val result = entryPoint.todayRepository().getToday()) {
                is ApiResult.Success -> result.data.inboxCount
                else -> try {
                    cachedInboxCount(entryPoint.todoRepository().getCachedTodosFlow().first())
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    null
                }
            }
        } else null

        provideContent {
            val appearance = WidgetAppearance.from(currentState())
            GlanceTheme {
                InboxQuickAddContent(
                    isConfigured = isConfigured,
                    inboxCount = inboxCount,
                    backgroundOpacity = appearance.backgroundOpacity,
                )
            }
        }
    }
}

internal fun cachedInboxCount(todos: List<Todo>): Int =
    todos.count { todo ->
        todo.status != TaskStatus.COMPLETED &&
            todo.status != TaskStatus.CANCELLED &&
            !todo.inboxState.isNullOrBlank() &&
            todo.inboxState != "none"
    }

/**
 * Two cells tall, as in the design: "Inbox" in grey over a round field that
 * opens the quick add. One cell tall, only the field. The count of what is
 * waiting stays grey beside the label (or at the end of the field).
 */
@Composable
internal fun InboxQuickAddContent(
    isConfigured: Boolean,
    inboxCount: Int?,
    backgroundOpacity: Float,
) {
    val context = LocalContext.current
    val size = LocalSize.current
    val quickAddIntent = QuickAddActivity.createIntent(context)
    val mainActivity = ComponentName(context.packageName, "com.clawchat.android.MainActivity")
    val action = if (isConfigured) actionStartActivityByIntent(quickAddIntent) else actionStartActivityByComponent(mainActivity)
    val waiting = inboxCount?.takeIf { it > 0 }
    val showLabel = size.height >= TwoRowHeight

    Column(
        modifier = GlanceModifier
            .fillMaxSize()
            .widgetBackground(backgroundOpacity)
            .padding(horizontal = 14.dp, vertical = if (showLabel) 12.dp else 6.dp)
            .clickable(action),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (showLabel) {
            Text(
                text = waiting?.let { context.getString(R.string.widget_inbox_with_count, it) }
                    ?: context.getString(R.string.widget_inbox),
                style = TextStyle(color = WidgetColors.Ink3, fontSize = 12.sp),
                maxLines = 1,
            )
            Spacer(GlanceModifier.height(6.dp))
        }
        Row(
            modifier = GlanceModifier
                .fillMaxWidth()
                .then(
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        GlanceModifier.cornerRadius(20.dp).background(WidgetColors.Raised)
                    } else {
                        GlanceModifier.background(WidgetColors.Raised)
                    },
                )
                .padding(horizontal = 12.dp, vertical = 8.dp)
                .clickable(action),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (isConfigured) {
                Image(
                    provider = ImageProvider(R.drawable.ic_widget_add),
                    contentDescription = null,
                    colorFilter = ColorFilter.tint(WidgetColors.Ink2),
                    modifier = GlanceModifier.size(14.dp),
                )
                Spacer(GlanceModifier.width(8.dp))
            }
            Text(
                text = context.getString(
                    if (isConfigured) R.string.widget_add_to_inbox else R.string.widget_login_required,
                ),
                style = TextStyle(color = WidgetColors.Ink2, fontSize = 13.sp),
                maxLines = 1,
                modifier = GlanceModifier.defaultWeight(),
            )
            if (!showLabel && waiting != null) {
                Spacer(GlanceModifier.width(8.dp))
                Text(
                    text = waiting.toString(),
                    style = TextStyle(color = WidgetColors.Ink3, fontSize = 12.sp),
                )
            }
        }
    }
}

/** From this height the widget has room for its label above the field. */
private val TwoRowHeight = 90.dp
