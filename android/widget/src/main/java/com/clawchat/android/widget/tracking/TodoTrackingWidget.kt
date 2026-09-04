package com.clawchat.android.widget.tracking

import android.content.ComponentName
import android.content.Context
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
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.actionStartActivity as actionStartActivityByComponent
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity as actionStartActivityByIntent
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.state.getAppWidgetState
import androidx.glance.background
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import com.clawchat.android.widget.R
import com.clawchat.android.widget.common.WidgetAppearance
import com.clawchat.android.widget.common.WidgetSize
import com.clawchat.android.widget.common.WidgetState
import com.clawchat.android.widget.common.widgetBackground
import com.clawchat.android.widget.common.widgetHorizonDays
import com.clawchat.android.widget.di.WidgetEntryPoint
import com.clawchat.android.widget.quickadd.QuickAddActivity
import dagger.hilt.android.EntryPointAccessors
import kotlinx.coroutines.flow.first
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter

class TodoTrackingWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val entryPoint = EntryPointAccessors.fromApplication(
            context.applicationContext,
            WidgetEntryPoint::class.java,
        )
        val sessionStore = entryPoint.sessionStore()
        val horizonDays = widgetHorizonDays(getAppWidgetState(context, PreferencesGlanceStateDefinition, id))
        val todoRepository = entryPoint.todoRepository()
        val snapshot = loadTodoWidgetSnapshot(
            horizonDays = horizonDays,
            runtimeState = { sessionStore.runtimeState.first() },
            loadDeadlines = { todoRepository.listTodos(deadlineQuery(horizonDays)) },
            loadCachedTodos = { todoRepository.getCachedTodosFlow().first() },
        )

        val mainActivity = ComponentName(context.packageName, "com.clawchat.android.MainActivity")

        provideContent {
            val appearance = WidgetAppearance.from(currentState())
            GlanceTheme {
                TodoTrackingContent(
                    state = snapshot.state,
                    mainActivity = mainActivity,
                    workspaceKey = snapshot.workspaceKey,
                    backgroundOpacity = appearance.backgroundOpacity,
                )
            }
        }
    }

    companion object {
        val TODO_ID_KEY = ActionParameters.Key<String>("todoId")
        val WORKSPACE_KEY = ActionParameters.Key<String>("workspaceKey")
    }
}

/**
 * Asks the server for everything due up to the end of the horizon, deadline
 * first. Overdue work has a due date in the past, so the same window carries
 * it without a second request.
 */
internal fun deadlineQuery(
    horizonDays: Int,
    today: LocalDate = LocalDate.now(),
): Map<String, String> = mapOf(
    // Inclusive of the last day: the server compares against the timestamp.
    "due_before" to today.plusDays(horizonDays.toLong())
        .atTime(LocalTime.of(23, 59, 59))
        .format(DateTimeFormatter.ISO_LOCAL_DATE_TIME),
    "order_by" to "due_date",
    "order_dir" to "asc",
    "limit" to "50",
)

@Composable
private fun TodoTrackingContent(
    state: WidgetState<TodoWidgetUiModel>,
    mainActivity: ComponentName,
    workspaceKey: String?,
    backgroundOpacity: Float,
) {
    val context = LocalContext.current
    val size = LocalSize.current
    val isLoggedIn = state !is WidgetState.NotLoggedIn
    val isCompactHeight = size.height <= WidgetSize.Height2
    val quickAddIntent = QuickAddActivity.createIntent(context)
    val taskCount = (state as? WidgetState.Success)?.data?.itemCount

    Column(
        modifier = GlanceModifier
            .fillMaxSize()
            .widgetBackground(backgroundOpacity),
    ) {
        Row(
            modifier = GlanceModifier
                .fillMaxWidth()
                .height(if (isCompactHeight) 40.dp else 44.dp)
                .padding(start = 14.dp, end = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = if (taskCount == null) {
                    context.getString(R.string.widget_tasks_title)
                } else {
                    context.getString(R.string.widget_tasks_title_with_count, taskCount)
                },
                style = TextStyle(
                    fontWeight = FontWeight.Bold,
                    color = GlanceTheme.colors.onSurface,
                    fontSize = if (size.width >= WidgetSize.Width4) 16.sp else 14.sp,
                ),
                modifier = GlanceModifier
                    .defaultWeight()
                    .clickable(actionStartActivityByComponent(mainActivity)),
            )
            if (isLoggedIn && isCompactHeight) {
                Image(
                    provider = ImageProvider(R.drawable.ic_widget_add),
                    contentDescription = context.getString(R.string.widget_add_task),
                    colorFilter = ColorFilter.tint(GlanceTheme.colors.primary),
                    modifier = GlanceModifier
                        .size(32.dp)
                        .padding(5.dp)
                        .clickable(actionStartActivityByIntent(quickAddIntent)),
                )
            }
            if (isLoggedIn && (!isCompactHeight || size.width >= WidgetSize.Width4)) {
                Image(
                    provider = ImageProvider(R.drawable.ic_widget_refresh),
                    contentDescription = context.getString(R.string.widget_refresh),
                    colorFilter = ColorFilter.tint(GlanceTheme.colors.onSurfaceVariant),
                    modifier = GlanceModifier
                        .size(32.dp)
                        .padding(7.dp)
                        .clickable(actionRunCallback<RefreshTodosAction>()),
                )
            }
        }

        when (state) {
            is WidgetState.NotLoggedIn -> CenterMessage(
                text = context.getString(R.string.widget_login_required),
                modifier = GlanceModifier
                    .defaultWeight()
                    .clickable(actionStartActivityByComponent(mainActivity)),
            )
            is WidgetState.Loading -> CenterMessage(
                context.getString(R.string.widget_loading),
                GlanceModifier.defaultWeight(),
            )
            is WidgetState.Error -> CenterMessage(
                context.getString(R.string.widget_load_error),
                GlanceModifier.defaultWeight(),
            )
            is WidgetState.Success -> {
                if (state.data.isEmpty) {
                    CenterMessage(
                        context.getString(R.string.widget_empty),
                        GlanceModifier.defaultWeight(),
                    )
                } else if (workspaceKey == null) {
                    CenterMessage(
                        context.getString(R.string.widget_login_required),
                        GlanceModifier.defaultWeight(),
                    )
                } else {
                    TodoList(
                        model = state.data,
                        mainActivity = mainActivity,
                        workspaceKey = workspaceKey,
                        compact = isCompactHeight,
                        modifier = GlanceModifier.defaultWeight(),
                    )
                }
            }
        }

        if (isLoggedIn && !isCompactHeight) {
            AddTaskAction()
        }
    }
}

@Composable
private fun TodoList(
    model: TodoWidgetUiModel,
    mainActivity: ComponentName,
    workspaceKey: String,
    compact: Boolean,
    modifier: GlanceModifier,
) {
    LazyColumn(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp),
        horizontalAlignment = Alignment.Start,
    ) {
        // Sorted by deadline, so the order alone carries the urgency that
        // section headings used to spell out.
        items(model.items, itemId = { it.id.hashCode().toLong() }) { todo ->
            TodoRow(
                todo = todo,
                mainActivity = mainActivity,
                workspaceKey = workspaceKey,
                compact = compact,
            )
        }
        item { Spacer(GlanceModifier.height(2.dp)) }
    }
}

@Composable
private fun TodoRow(
    todo: TodoWidgetItem,
    mainActivity: ComponentName,
    workspaceKey: String,
    compact: Boolean,
) {
    val context = LocalContext.current
    Row(
        modifier = GlanceModifier
            .fillMaxWidth()
            .height(42.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = GlanceModifier
                .size(42.dp)
                .clickable(
                    actionRunCallback<CompleteTodoAction>(
                        actionParametersOf(
                            TodoTrackingWidget.TODO_ID_KEY to todo.id,
                            TodoTrackingWidget.WORKSPACE_KEY to workspaceKey,
                        ),
                    )
                ),
            contentAlignment = Alignment.Center,
        ) {
            Image(
                provider = ImageProvider(R.drawable.ic_widget_circle),
                contentDescription = context.getString(R.string.widget_mark_done, todo.title),
                colorFilter = ColorFilter.tint(
                    if (todo.isOverdue) GlanceTheme.colors.error
                    else GlanceTheme.colors.primary
                ),
                modifier = GlanceModifier.size(22.dp),
            )
        }

        Text(
            text = todo.title,
            modifier = GlanceModifier
                .defaultWeight()
                .clickable(actionStartActivityByComponent(mainActivity)),
            style = TextStyle(
                color = if (todo.isOverdue) GlanceTheme.colors.error
                else GlanceTheme.colors.onSurface,
                fontSize = 14.sp,
            ),
            maxLines = 1,
        )

        if (!compact) {
            Spacer(GlanceModifier.width(8.dp))
            RunwayBar(todo = todo)
        }
        Spacer(GlanceModifier.width(8.dp))
        Text(
            text = deadlineLabel(context, todo.daysRemaining),
            style = TextStyle(
                color = if (todo.isOverdue) GlanceTheme.colors.error
                else GlanceTheme.colors.onSurfaceVariant,
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
            ),
            maxLines = 1,
        )
        Spacer(GlanceModifier.width(8.dp))
    }
}

/** Width of the runway track. Kept square and flat: a line, not a pill. */
private val RunwayTrackWidth = 40.dp

@Composable
private fun RunwayBar(todo: TodoWidgetItem) {
    val filled = (RunwayTrackWidth.value * todo.runwayFraction).dp
    Box(
        modifier = GlanceModifier.width(RunwayTrackWidth).height(3.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        Box(
            modifier = GlanceModifier
                .fillMaxWidth()
                .height(3.dp)
                .background(GlanceTheme.colors.surfaceVariant),
            content = {},
        )
        if (filled.value > 0f) {
            Box(
                modifier = GlanceModifier
                    .width(filled)
                    .height(3.dp)
                    .background(
                        if (todo.isOverdue) GlanceTheme.colors.error
                        else GlanceTheme.colors.primary
                    ),
                content = {},
            )
        }
    }
}

private fun deadlineLabel(context: Context, daysRemaining: Int): String = when {
    daysRemaining < 0 -> context.getString(R.string.widget_days_overdue, -daysRemaining)
    daysRemaining == 0 -> context.getString(R.string.widget_due_today)
    else -> context.getString(R.string.widget_days_remaining, daysRemaining)
}

@Composable
private fun AddTaskAction() {
    val context = LocalContext.current
    val quickAddIntent = QuickAddActivity.createIntent(context)
    Row(
        modifier = GlanceModifier
            .fillMaxWidth()
            .height(42.dp)
            .padding(horizontal = 12.dp)
            .clickable(actionStartActivityByIntent(quickAddIntent)),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Image(
            provider = ImageProvider(R.drawable.ic_widget_add),
            contentDescription = null,
            colorFilter = ColorFilter.tint(GlanceTheme.colors.primary),
            modifier = GlanceModifier.size(22.dp),
        )
        Spacer(GlanceModifier.width(10.dp))
        Text(
            text = context.getString(R.string.widget_add_task),
            style = TextStyle(
                color = GlanceTheme.colors.primary,
                fontWeight = FontWeight.Medium,
                fontSize = 14.sp,
            ),
        )
    }
}

@Composable
private fun CenterMessage(
    text: String,
    modifier: GlanceModifier,
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            style = TextStyle(
                color = GlanceTheme.colors.onSurfaceVariant,
                fontSize = 13.sp,
            ),
            maxLines = 2,
        )
    }
}
