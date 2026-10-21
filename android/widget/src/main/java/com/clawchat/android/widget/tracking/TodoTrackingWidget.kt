package com.clawchat.android.widget.tracking

import android.content.ComponentName
import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.datastore.preferences.core.Preferences
import androidx.compose.ui.unit.Dp
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
import androidx.glance.background
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
import androidx.glance.text.TextDecoration
import androidx.glance.text.TextStyle
import com.clawchat.android.widget.R
import com.clawchat.android.widget.common.WidgetAppearance
import com.clawchat.android.widget.common.WidgetColors
import com.clawchat.android.widget.common.WidgetSize
import com.clawchat.android.widget.common.WidgetState
import com.clawchat.android.widget.common.widgetBackground
import com.clawchat.android.widget.common.widgetHorizonDays
import com.clawchat.android.widget.di.WidgetEntryPoint
import com.clawchat.android.widget.quickadd.QuickAddActivity
import dagger.hilt.android.EntryPointAccessors
import kotlinx.coroutines.flow.first
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

class TodoTrackingWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val entryPoint = EntryPointAccessors.fromApplication(
            context.applicationContext,
            WidgetEntryPoint::class.java,
        )
        val sessionStore = entryPoint.sessionStore()
        val initialRuntime = sessionStore.runtimeState.first()
        val todoRepository = entryPoint.todoRepository()
        val noteRepository = entryPoint.noteRepository()

        val mainActivity = ComponentName(context.packageName, "com.clawchat.android.MainActivity")

        provideContent {
            val preferences = currentState<Preferences>()
            val appearance = WidgetAppearance.from(preferences)
            val horizonDays = widgetHorizonDays(preferences)
            val contentMode = widgetContentMode(preferences)
            val refreshToken = preferences[WidgetRefreshKey]
            val runtime by sessionStore.runtimeState.collectAsState(initialRuntime)
            val snapshots = remember(contentMode, horizonDays, refreshToken) {
                observeTodoWidgetSnapshots<TrackingWidgetData>(sessionStore.runtimeState) {
                    when (contentMode) {
                        WidgetContentMode.TASKS -> loadTodoWidgetSnapshot(
                            horizonDays = horizonDays,
                            runtimeState = { sessionStore.runtimeState.first() },
                            loadOpenTodos = { loadOpenWidgetTodos(openTodosQuery(), todoRepository::listTodos) },
                            loadCachedTodos = { todoRepository.getCachedTodosFlow().first() },
                        )
                        WidgetContentMode.NOTES -> loadNoteWidgetSnapshot(
                            runtimeState = { sessionStore.runtimeState.first() },
                            loadNotes = noteRepository::list,
                        )
                    }
                }
            }
            val snapshot by snapshots.collectAsState(WidgetSnapshot(WidgetState.Loading, null))
            val currentWorkspace = snapshot.workspaceKey == runtime.workspaceKey
            GlanceTheme {
                TodoTrackingContent(
                    state = if (currentWorkspace) snapshot.state else WidgetState.Loading,
                    contentMode = contentMode,
                    horizonDays = horizonDays,
                    mainActivity = mainActivity,
                    workspaceKey = if (currentWorkspace) snapshot.workspaceKey else null,
                    backgroundOpacity = appearance.backgroundOpacity,
                    completingIds = preferences[WidgetCompletingIdsKey].orEmpty(),
                    completionFailed = contentMode == WidgetContentMode.TASKS &&
                        currentWorkspace && runtime.workspaceKey != null &&
                        preferences[WidgetCompletionErrorWorkspaceKey] == runtime.workspaceKey,
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
 * Asks the server for every open task, deadline first. The projection splits
 * them into the runway, the undated and in-progress rows, and the next
 * deadline past the horizon, so one window answers all three. The limit is
 * generous because undated tasks sort ahead of dated ones on the server.
 */
internal fun openTodosQuery(): Map<String, String> = mapOf(
    "order_by" to "due_date",
    "order_dir" to "asc",
    "limit" to "200",
)

@Composable
internal fun TodoTrackingContent(
    state: WidgetState<TrackingWidgetData>,
    contentMode: WidgetContentMode,
    horizonDays: Int,
    mainActivity: ComponentName,
    workspaceKey: String?,
    backgroundOpacity: Float,
    completingIds: Set<String> = emptySet(),
    completionFailed: Boolean = false,
) {
    val context = LocalContext.current
    val size = LocalSize.current
    val isLoggedIn = state !is WidgetState.NotLoggedIn
    val isCompactHeight = size.height <= WidgetSize.Height2
    // Two cells by two: a tile with only its title, as in the design.
    val isTile = isCompactHeight && size.width < WidgetSize.Width4
    val count = when (val data = (state as? WidgetState.Success)?.data) {
        is TodoWidgetUiModel -> data.itemCount.takeIf { !data.isEmpty }
        is NoteWidgetUiModel -> data.items.size
        null -> null
    }
    val headerHeight = if (isTile) 36.dp else 44.dp
    // What is left for the list once the header and the error line have their share.
    val listHeight = size.height - headerHeight - 12.dp -
        (if (completionFailed) 18.dp else 0.dp)

    // Any tap that lands on nothing more specific opens the app: the blank
    // space under a short list, the header between tabs and icons, a message.
    Column(
        modifier = GlanceModifier
            .fillMaxSize()
            .widgetBackground(backgroundOpacity)
            .padding(top = 4.dp, bottom = 8.dp)
            .clickable(actionStartActivityByComponent(mainActivity)),
    ) {
        if (isTile) {
            TileHeader(contentMode, headerHeight)
        } else {
            Row(
                modifier = GlanceModifier
                    .fillMaxWidth()
                    .height(headerHeight)
                    .padding(start = 14.dp, end = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                WidgetContentMode.entries.forEachIndexed { index, mode ->
                    if (index > 0) Spacer(GlanceModifier.width(12.dp))
                    HeaderTab(
                        mode = mode,
                        active = mode == contentMode,
                        count = count.takeIf { mode == contentMode },
                    )
                }
                Spacer(GlanceModifier.defaultWeight())
                if (isLoggedIn) {
                    HeaderIcon(
                        icon = R.drawable.ic_widget_add,
                        description = context.getString(R.string.widget_add_task),
                        tint = WidgetColors.Ink2,
                        action = actionStartActivityByIntent(QuickAddActivity.createIntent(context)),
                    )
                    HeaderIcon(
                        icon = R.drawable.ic_widget_refresh,
                        description = context.getString(R.string.widget_refresh),
                        tint = WidgetColors.Ink3,
                        action = actionRunCallback<RefreshTodosAction>(),
                    )
                }
            }
        }

        if (completionFailed) {
            Text(
                context.getString(R.string.widget_complete_failed),
                style = TextStyle(color = WidgetColors.Red, fontSize = 12.sp),
                modifier = GlanceModifier
                    .padding(horizontal = 14.dp)
                    .clickable(actionStartActivityByComponent(mainActivity)),
            )
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
                GlanceModifier
                    .defaultWeight()
                    .clickable(actionRunCallback<RefreshTodosAction>()),
                maxLines = 4,
            )
            is WidgetState.Success -> when (val data = state.data) {
                is NoteWidgetUiModel -> if (data.isEmpty) {
                    CenterMessage(
                        context.getString(R.string.widget_notes_empty),
                        GlanceModifier.defaultWeight(),
                    )
                } else {
                    NoteList(
                        model = data,
                        mainActivity = mainActivity,
                        availableHeight = listHeight,
                        modifier = GlanceModifier.defaultWeight(),
                    )
                }
                is TodoWidgetUiModel -> if (data.isEmpty) {
                    // Saying why the list is empty, and what comes next, is
                    // what keeps an empty runway from reading as a broken widget.
                    EmptyRunway(
                        model = data,
                        horizonDays = horizonDays,
                        modifier = GlanceModifier
                            .defaultWeight()
                            .clickable(actionStartActivityByComponent(mainActivity)),
                    )
                } else if (workspaceKey == null) {
                    CenterMessage(
                        context.getString(R.string.widget_login_required),
                        GlanceModifier.defaultWeight(),
                    )
                } else {
                    TodoList(
                        model = data,
                        horizonDays = horizonDays,
                        mainActivity = mainActivity,
                        workspaceKey = workspaceKey,
                        compact = isTile,
                        completingIds = completingIds,
                        availableHeight = listHeight,
                        modifier = GlanceModifier.defaultWeight(),
                    )
                }
            }
        }
    }
}

/** The tile's only heading: the tab it shows, small and bold. */
@Composable
private fun TileHeader(mode: WidgetContentMode, height: Dp) {
    val context = LocalContext.current
    Box(
        modifier = GlanceModifier
            .fillMaxWidth()
            .height(height)
            .padding(horizontal = 14.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(
            text = context.getString(
                when (mode) {
                    WidgetContentMode.TASKS -> R.string.widget_tasks_title
                    WidgetContentMode.NOTES -> R.string.widget_notes_title
                },
            ),
            style = TextStyle(color = WidgetColors.Ink, fontSize = 13.sp, fontWeight = FontWeight.Bold),
            maxLines = 1,
        )
    }
}

@Composable
private fun HeaderIcon(
    icon: Int,
    description: String,
    tint: androidx.glance.unit.ColorProvider,
    action: androidx.glance.action.Action,
) {
    Box(
        modifier = GlanceModifier.size(36.dp).clickable(action),
        contentAlignment = Alignment.Center,
    ) {
        Image(
            provider = ImageProvider(icon),
            contentDescription = description,
            colorFilter = ColorFilter.tint(tint),
            modifier = GlanceModifier.size(20.dp),
        )
    }
}

/**
 * A tab only ever switches tabs. When the active title also opened the app,
 * the same word did two different things depending on which tab was showing;
 * the app now opens from the rows and the blank space instead.
 */
@Composable
private fun HeaderTab(
    mode: WidgetContentMode,
    active: Boolean,
    count: Int?,
) {
    val context = LocalContext.current
    val (title, titleWithCount) = when (mode) {
        WidgetContentMode.TASKS -> R.string.widget_tasks_title to R.string.widget_tasks_title_with_count
        WidgetContentMode.NOTES -> R.string.widget_notes_title to R.string.widget_notes_title_with_count
    }
    Text(
        text = if (count == null) context.getString(title) else context.getString(titleWithCount, count),
        style = TextStyle(
            fontWeight = if (active) FontWeight.Bold else FontWeight.Medium,
            color = if (active) WidgetColors.Ink else WidgetColors.Ink3,
            fontSize = 15.sp,
        ),
        maxLines = 1,
        modifier = GlanceModifier.clickable(
            actionRunCallback<SwitchWidgetContentAction>(
                actionParametersOf(SwitchWidgetContentAction.MODE_KEY to mode.name),
            ),
        ),
    )
}

/**
 * No deadline inside the horizon: say so in grey, then name the next one,
 * left-aligned under the title as the design's small tile does.
 */
@Composable
private fun EmptyRunway(model: TodoWidgetUiModel, horizonDays: Int, modifier: GlanceModifier) {
    val context = LocalContext.current
    Column(modifier = modifier.fillMaxWidth().padding(horizontal = 14.dp)) {
        Text(
            text = if (model.nextDeadline != null) {
                context.getString(R.string.widget_no_deadlines_within, horizonDays)
            } else {
                context.getString(R.string.widget_empty)
            },
            style = TextStyle(color = WidgetColors.Ink3, fontSize = 12.sp),
            maxLines = 2,
        )
        Spacer(GlanceModifier.defaultWeight())
        model.nextDeadline?.let { next ->
            Text(
                text = nextDeadlineText(context, next),
                style = TextStyle(color = WidgetColors.Ink2, fontSize = 12.sp),
                maxLines = 2,
            )
        }
    }
}

@Composable
private fun TodoList(
    model: TodoWidgetUiModel,
    horizonDays: Int,
    mainActivity: ComponentName,
    workspaceKey: String,
    compact: Boolean,
    completingIds: Set<String>,
    availableHeight: Dp,
    modifier: GlanceModifier,
) {
    val context = LocalContext.current
    val entries = buildList {
        // Sorted by deadline, so the order alone carries the urgency that
        // section headings used to spell out.
        model.deadlines.forEach { todo ->
            add(ListEntry(todo.id.hashCode().toLong(), TodoRowHeight) {
                TodoRow(todo, mainActivity, workspaceKey, compact, done = todo.id in completingIds)
            })
        }
        if (model.deadlines.isEmpty()) {
            val text = context.getString(R.string.widget_no_deadlines_within, horizonDays) +
                (model.nextDeadline?.let { " · " + nextDeadlineText(context, it) } ?: "")
            add(ListEntry(-1L, ListNoteHeight) { ListNote(text, mainActivity) })
        }
        if (model.others.isNotEmpty()) {
            // The one heading left: below it the rows stop being a runway.
            if (model.deadlines.isNotEmpty()) {
                val text = context.getString(R.string.widget_other_tasks)
                add(ListEntry(-2L, ListNoteHeight) { ListNote(text, mainActivity) })
            }
            model.others.forEach { todo ->
                add(ListEntry(todo.id.hashCode().toLong(), TodoRowHeight) {
                    TodoRow(todo, mainActivity, workspaceKey, compact, done = todo.id in completingIds)
                })
            }
        }
    }
    WidgetList(entries, availableHeight, modifier)
}

private val TodoRowHeight = 42.dp
private val NoteRowHeight = 40.dp
private val ListNoteHeight = 30.dp
private const val MaxColumnChildren = 10

/** One row of a widget list, with the fixed height that decides whether the list fits. */
private class ListEntry(
    val id: Long,
    val height: Dp,
    val content: @Composable () -> Unit,
)

/**
 * A list that fits is laid out as a plain column. A scrolling widget list
 * swallows taps on the blank space under its rows, while a column leaves them
 * to the widget body, which opens the app. Only a list too long to fit scrolls.
 * Glance renders at most ten children in a Column, so more rows always scroll.
 */
@Composable
private fun WidgetList(entries: List<ListEntry>, availableHeight: Dp, modifier: GlanceModifier) {
    val listModifier = modifier
        .fillMaxWidth()
        .padding(horizontal = 8.dp)
    val fits = entries.size <= MaxColumnChildren &&
        entries.sumOf { it.height.value.toDouble() } <= availableHeight.value
    if (fits) {
        Column(modifier = listModifier) {
            entries.forEach { it.content() }
        }
    } else {
        LazyColumn(modifier = listModifier, horizontalAlignment = Alignment.Start) {
            items(entries, itemId = { it.id }) { it.content() }
            item { Spacer(GlanceModifier.height(2.dp)) }
        }
    }
}

/** A grey line between groups, sitting on the rows below it. */
@Composable
private fun ListNote(text: String, mainActivity: ComponentName) {
    Box(
        modifier = GlanceModifier
            .fillMaxWidth()
            .height(ListNoteHeight)
            .padding(start = 8.dp, end = 8.dp, bottom = 4.dp)
            .clickable(actionStartActivityByComponent(mainActivity)),
        contentAlignment = Alignment.BottomStart,
    ) {
        Text(
            text = text,
            style = TextStyle(color = WidgetColors.Ink3, fontSize = 12.sp),
            maxLines = 1,
        )
    }
}

@Composable
private fun TodoRow(
    todo: TodoWidgetItem,
    mainActivity: ComponentName,
    workspaceKey: String,
    compact: Boolean,
    done: Boolean = false,
) {
    val context = LocalContext.current
    // The whole row opens the app; only the circle completes the task.
    Row(
        modifier = GlanceModifier
            .fillMaxWidth()
            .height(TodoRowHeight)
            .clickable(actionStartActivityByComponent(mainActivity)),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = GlanceModifier
                .size(42.dp)
                .then(
                    if (done) {
                        GlanceModifier
                    } else {
                        GlanceModifier.clickable(
                            actionRunCallback<CompleteTodoAction>(
                                actionParametersOf(
                                    TodoTrackingWidget.TODO_ID_KEY to todo.id,
                                    TodoTrackingWidget.WORKSPACE_KEY to workspaceKey,
                                ),
                            )
                        )
                    },
                ),
            contentAlignment = Alignment.Center,
        ) {
            if (done) {
                // Just checked: a filled blue disc with a tick, until the list drops it.
                Box(
                    modifier = GlanceModifier
                        .size(18.dp)
                        .background(
                            imageProvider = ImageProvider(R.drawable.ic_widget_dot),
                            colorFilter = ColorFilter.tint(WidgetColors.Blue),
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Image(
                        provider = ImageProvider(R.drawable.ic_widget_check),
                        contentDescription = context.getString(R.string.widget_marked_done, todo.title),
                        colorFilter = ColorFilter.tint(WidgetColors.OnBlue),
                        modifier = GlanceModifier.size(12.dp),
                    )
                }
            } else {
                // A quiet grey ring: the runway and the D-label carry the urgency.
                Image(
                    provider = ImageProvider(R.drawable.ic_widget_check_ring),
                    contentDescription = context.getString(R.string.widget_mark_done, todo.title),
                    colorFilter = ColorFilter.tint(WidgetColors.Ink3),
                    modifier = GlanceModifier.size(18.dp),
                )
            }
        }

        Text(
            text = todo.title,
            modifier = GlanceModifier.defaultWeight(),
            style = TextStyle(
                color = if (done) WidgetColors.Ink3 else WidgetColors.Ink,
                fontSize = 14.sp,
                textDecoration = if (done) TextDecoration.LineThrough else TextDecoration.None,
            ),
            maxLines = 1,
        )

        val runway = todo.runwayFraction.takeUnless { done }
        if (!compact && runway != null) {
            Spacer(GlanceModifier.width(8.dp))
            RunwayBar(fraction = runway, overdue = todo.isOverdue)
        }
        val label = if (done) {
            null
        } else {
            todo.daysRemaining?.let { deadlineLabel(context, it) }
                ?: context.getString(R.string.widget_in_progress).takeIf { todo.inProgress }
        }
        if (label != null) {
            Spacer(GlanceModifier.width(8.dp))
            Text(
                text = label,
                style = TextStyle(
                    color = if (todo.isOverdue) WidgetColors.Red else WidgetColors.Ink3,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Medium,
                ),
                maxLines = 1,
            )
        }
        Spacer(GlanceModifier.width(8.dp))
    }
}

/** Width of the runway track. Kept square and flat: a line, not a pill. */
private val RunwayTrackWidth = 40.dp

@Composable
private fun RunwayBar(fraction: Float, overdue: Boolean) {
    val filled = (RunwayTrackWidth.value * fraction).dp
    Box(
        modifier = GlanceModifier.width(RunwayTrackWidth).height(3.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        Box(
            modifier = GlanceModifier
                .fillMaxWidth()
                .height(3.dp)
                .background(WidgetColors.Raised),
            content = {},
        )
        if (filled.value > 0f) {
            Box(
                modifier = GlanceModifier
                    .width(filled)
                    .height(3.dp)
                    .background(if (overdue) WidgetColors.Red else WidgetColors.Blue),
                content = {},
            )
        }
    }
}

@Composable
private fun NoteList(
    model: NoteWidgetUiModel,
    mainActivity: ComponentName,
    availableHeight: Dp,
    modifier: GlanceModifier,
) {
    val entries = model.items.map { note ->
        ListEntry(note.id.hashCode().toLong(), NoteRowHeight) { NoteRow(note, mainActivity) }
    }
    WidgetList(entries, availableHeight, modifier)
}

@Composable
private fun NoteRow(note: NoteWidgetItem, mainActivity: ComponentName) {
    val context = LocalContext.current
    Row(
        modifier = GlanceModifier
            .fillMaxWidth()
            .height(NoteRowHeight)
            .padding(horizontal = 8.dp)
            .clickable(actionStartActivityByComponent(mainActivity)),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = note.headline,
            style = TextStyle(color = WidgetColors.Ink, fontSize = 14.sp),
            maxLines = 1,
            modifier = GlanceModifier.defaultWeight(),
        )
        val label = when (noteAge(note, LocalDate.now())) {
            NoteAge.TIME -> note.updatedAt?.let { shortTime(context, it) }
            NoteAge.TODAY -> context.getString(R.string.widget_today)
            NoteAge.DATE -> note.updatedOn?.let { shortDate(context, it) }
        }
        label?.let { text ->
            Spacer(GlanceModifier.width(8.dp))
            Text(
                text = text,
                style = TextStyle(
                    color = WidgetColors.Ink3,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Medium,
                ),
                maxLines = 1,
            )
        }
    }
}

private fun deadlineLabel(context: Context, daysRemaining: Int): String = when {
    daysRemaining < 0 -> context.getString(R.string.widget_days_overdue, -daysRemaining)
    daysRemaining == 0 -> context.getString(R.string.widget_due_today)
    else -> context.getString(R.string.widget_days_remaining, daysRemaining)
}

private fun shortTime(context: Context, moment: Instant): String =
    DateTimeFormatter
        .ofLocalizedTime(FormatStyle.SHORT)
        .withLocale(context.resources.configuration.locales[0])
        .format(moment.atZone(ZoneId.systemDefault()))

private fun shortDate(context: Context, day: LocalDate): String =
    DateTimeFormatter
        .ofPattern(context.getString(R.string.widget_short_date_pattern), context.resources.configuration.locales[0])
        .format(day)

private fun nextDeadlineText(context: Context, next: NextDeadline): String =
    context.getString(
        R.string.widget_next_deadline,
        shortDate(context, next.dueDate),
        deadlineLabel(context, next.daysRemaining),
        next.title,
    )

@Composable
private fun CenterMessage(
    text: String,
    modifier: GlanceModifier,
    maxLines: Int = 2,
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
                color = WidgetColors.Ink3,
                fontSize = 13.sp,
            ),
            maxLines = maxLines,
        )
    }
}
