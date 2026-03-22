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
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextDecoration
import androidx.glance.text.TextStyle
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodayResponse
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.widget.R
import com.clawchat.android.widget.common.WidgetSize
import com.clawchat.android.widget.common.WidgetState
import com.clawchat.android.widget.common.widgetBackground
import com.clawchat.android.widget.common.widgetItemBackground
import com.clawchat.android.widget.di.WidgetEntryPoint
import dagger.hilt.android.EntryPointAccessors
import kotlinx.coroutines.flow.first
import java.time.LocalDate
import java.time.format.DateTimeFormatter

class TodoTrackingWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val entryPoint = EntryPointAccessors.fromApplication(
            context.applicationContext,
            WidgetEntryPoint::class.java,
        )
        val token = entryPoint.sessionStore().token.first()

        val state: WidgetState<TodayResponse> = if (token == null) {
            WidgetState.NotLoggedIn
        } else {
            when (val result = entryPoint.todayRepository().getToday()) {
                is ApiResult.Success -> WidgetState.Success(result.data)
                is ApiResult.Error -> WidgetState.Error(result.message)
                is ApiResult.Loading -> WidgetState.Loading
            }
        }

        val mainActivity = ComponentName(context.packageName, "com.clawchat.android.MainActivity")

        provideContent {
            GlanceTheme {
                TodoTrackingContent(state = state, mainActivity = mainActivity)
            }
        }
    }

    companion object {
        val TODO_ID_KEY = ActionParameters.Key<String>("todoId")
        val CURRENT_STATUS_KEY = ActionParameters.Key<String>("currentStatus")
    }
}

@Composable
private fun TodoTrackingContent(
    state: WidgetState<TodayResponse>,
    mainActivity: ComponentName,
) {
    val size = LocalSize.current
    val context = LocalContext.current

    Column(
        modifier = GlanceModifier
            .fillMaxSize()
            .widgetBackground()
            .clickable(actionStartActivity(mainActivity)),
    ) {
        // Title bar
        Row(
            modifier = GlanceModifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = LocalDate.now().format(DateTimeFormatter.ofPattern("EEEE, MMM d")),
                style = TextStyle(
                    fontWeight = FontWeight.Bold,
                    color = GlanceTheme.colors.onSurface,
                    fontSize = if (size.width >= WidgetSize.Width4) 16.sp else 14.sp,
                ),
                modifier = GlanceModifier.defaultWeight(),
            )
            if (size.width >= WidgetSize.Width4) {
                Image(
                    provider = ImageProvider(R.drawable.ic_widget_refresh),
                    contentDescription = "Refresh",
                    colorFilter = ColorFilter.tint(GlanceTheme.colors.onSurfaceVariant),
                    modifier = GlanceModifier
                        .padding(4.dp)
                        .clickable(actionRunCallback<RefreshTodosAction>()),
                )
            }
        }

        when (state) {
            is WidgetState.NotLoggedIn -> CenterMessage("Please log in to ClawChat")
            is WidgetState.Loading -> CenterMessage("Loading...")
            is WidgetState.Error -> CenterMessage("Could not load data")
            is WidgetState.Success -> {
                val today = state.data
                val allTodos = today.todayTodos + today.overdueTodos
                if (allTodos.isEmpty()) {
                    CenterMessage("No todos for today")
                } else {
                    TodoList(
                        todayTodos = today.todayTodos,
                        overdueTodos = today.overdueTodos,
                    )
                }
            }
        }
    }
}

@Composable
private fun TodoList(
    todayTodos: List<Todo>,
    overdueTodos: List<Todo>,
) {
    LazyColumn(
        modifier = GlanceModifier.fillMaxSize().padding(horizontal = 8.dp),
        horizontalAlignment = Alignment.Start,
    ) {
        if (overdueTodos.isNotEmpty()) {
            item {
                Text(
                    text = "Overdue",
                    style = TextStyle(
                        fontWeight = FontWeight.Bold,
                        color = GlanceTheme.colors.error,
                        fontSize = 12.sp,
                    ),
                    modifier = GlanceModifier.padding(start = 4.dp, bottom = 4.dp),
                )
            }
            items(overdueTodos, itemId = { it.id.hashCode().toLong() }) { todo ->
                TodoRow(todo)
            }
            item { Spacer(GlanceModifier.height(8.dp)) }
        }

        if (todayTodos.isNotEmpty()) {
            if (overdueTodos.isNotEmpty()) {
                item {
                    Text(
                        text = "Today",
                        style = TextStyle(
                            fontWeight = FontWeight.Bold,
                            color = GlanceTheme.colors.onSurfaceVariant,
                            fontSize = 12.sp,
                        ),
                        modifier = GlanceModifier.padding(start = 4.dp, bottom = 4.dp),
                    )
                }
            }
            items(todayTodos, itemId = { it.id.hashCode().toLong() }) { todo ->
                TodoRow(todo)
            }
        }

        item { Spacer(GlanceModifier.height(4.dp)) }
    }
}

@Composable
private fun TodoRow(todo: Todo) {
    val completed = todo.status == "completed"

    Column(modifier = GlanceModifier.padding(bottom = 4.dp)) {
        Row(
            modifier = GlanceModifier
                .fillMaxWidth()
                .widgetItemBackground(completed)
                .padding(horizontal = 10.dp, vertical = 8.dp)
                .clickable(
                    actionRunCallback<ToggleTodoAction>(
                        actionParametersOf(
                            TodoTrackingWidget.TODO_ID_KEY to todo.id,
                            TodoTrackingWidget.CURRENT_STATUS_KEY to todo.status,
                        )
                    )
                ),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Priority indicator
            if (todo.priority == "high" || todo.priority == "urgent") {
                Box(
                    modifier = GlanceModifier
                        .width(4.dp)
                        .height(16.dp),
                ) {
                    Image(
                        provider = ImageProvider(R.drawable.ic_widget_priority),
                        contentDescription = null,
                        colorFilter = ColorFilter.tint(GlanceTheme.colors.error),
                    )
                }
                Spacer(GlanceModifier.width(8.dp))
            }

            Text(
                text = todo.title,
                modifier = GlanceModifier.defaultWeight(),
                style = TextStyle(
                    color = if (!completed) GlanceTheme.colors.onSecondaryContainer
                    else GlanceTheme.colors.onTertiaryContainer,
                    textDecoration = if (completed) TextDecoration.LineThrough
                    else TextDecoration.None,
                ),
                maxLines = 2,
            )

            Spacer(GlanceModifier.width(8.dp))

            Image(
                provider = ImageProvider(
                    if (completed) R.drawable.ic_widget_check_circle
                    else R.drawable.ic_widget_circle
                ),
                contentDescription = if (completed) "Completed" else "Pending",
                colorFilter = ColorFilter.tint(
                    if (completed) GlanceTheme.colors.primary
                    else GlanceTheme.colors.onSurfaceVariant
                ),
            )
        }
    }
}

@Composable
private fun CenterMessage(text: String) {
    Box(
        modifier = GlanceModifier.fillMaxSize().padding(16.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant),
        )
    }
}
