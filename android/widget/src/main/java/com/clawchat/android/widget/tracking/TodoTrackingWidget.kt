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
import androidx.glance.action.actionStartActivity as actionStartActivityByComponent
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity as actionStartActivityByIntent
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
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.widget.R
import com.clawchat.android.widget.common.WidgetSize
import com.clawchat.android.widget.common.WidgetState
import com.clawchat.android.widget.common.widgetBackground
import com.clawchat.android.widget.di.WidgetEntryPoint
import com.clawchat.android.widget.quickadd.QuickAddActivity
import com.clawchat.android.widget.quickadd.QuickAddTarget
import dagger.hilt.android.EntryPointAccessors
import kotlinx.coroutines.flow.first

class TodoTrackingWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val entryPoint = EntryPointAccessors.fromApplication(
            context.applicationContext,
            WidgetEntryPoint::class.java,
        )
        val token = entryPoint.sessionStore().token.first()

        val state: WidgetState<TodoWidgetUiModel> = if (token == null) {
            WidgetState.NotLoggedIn
        } else {
            when (val result = entryPoint.todayRepository().getToday()) {
                is ApiResult.Success -> WidgetState.Success(TodoWidgetUiModel.from(result.data))
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
    }
}

@Composable
private fun TodoTrackingContent(
    state: WidgetState<TodoWidgetUiModel>,
    mainActivity: ComponentName,
) {
    val context = LocalContext.current
    val size = LocalSize.current
    val isLoggedIn = state !is WidgetState.NotLoggedIn
    val isCompactHeight = size.height <= WidgetSize.Height2
    val quickAddIntent = QuickAddActivity.createIntent(context, QuickAddTarget.TODAY)

    Column(
        modifier = GlanceModifier
            .fillMaxSize()
            .widgetBackground(),
    ) {
        Row(
            modifier = GlanceModifier
                .fillMaxWidth()
                .height(if (isCompactHeight) 40.dp else 44.dp)
                .padding(start = 14.dp, end = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = context.getString(R.string.widget_today_title),
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
                } else {
                    TodoList(
                        model = state.data,
                        mainActivity = mainActivity,
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
    compact: Boolean,
    modifier: GlanceModifier,
) {
    val context = LocalContext.current
    LazyColumn(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp),
        horizontalAlignment = Alignment.Start,
    ) {
        if (model.overdue.isNotEmpty() && !compact) {
            item {
                Text(
                    text = context.getString(R.string.widget_overdue),
                    style = TextStyle(
                        fontWeight = FontWeight.Bold,
                        color = GlanceTheme.colors.error,
                        fontSize = 11.sp,
                    ),
                    modifier = GlanceModifier.padding(start = 44.dp, top = 2.dp, bottom = 2.dp),
                )
            }
        }
        items(model.overdue, itemId = { it.id.hashCode().toLong() }) { todo ->
            TodoRow(todo = todo, mainActivity = mainActivity)
        }

        items(model.today, itemId = { it.id.hashCode().toLong() }) { todo ->
            TodoRow(todo = todo, mainActivity = mainActivity)
        }
        item { Spacer(GlanceModifier.height(2.dp)) }
    }
}

@Composable
private fun TodoRow(
    todo: TodoWidgetItem,
    mainActivity: ComponentName,
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
                        actionParametersOf(TodoTrackingWidget.TODO_ID_KEY to todo.id)
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

        if (todo.isHighPriority) {
            Spacer(GlanceModifier.width(4.dp))
            Image(
                provider = ImageProvider(R.drawable.ic_widget_priority),
                contentDescription = null,
                colorFilter = ColorFilter.tint(GlanceTheme.colors.error),
                modifier = GlanceModifier.size(16.dp),
            )
        }
        Spacer(GlanceModifier.width(8.dp))
    }
}

@Composable
private fun AddTaskAction() {
    val context = LocalContext.current
    val quickAddIntent = QuickAddActivity.createIntent(context, QuickAddTarget.TODAY)
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
