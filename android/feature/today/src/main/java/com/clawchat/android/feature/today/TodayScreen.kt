package com.clawchat.android.feature.today

import android.os.Build
import android.view.HapticFeedbackConstants
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalLocale
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.clawchat.android.core.data.model.BriefingResponse
import com.clawchat.android.core.data.model.BriefingSuggestion
import com.clawchat.android.core.data.model.Event
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.ui.ClawEmptyState
import com.clawchat.android.core.ui.ClawListSection
import com.clawchat.android.core.ui.ClawListItemSurface
import com.clawchat.android.core.ui.ClawSectionHeader
import com.clawchat.android.core.ui.ClawStatusChip
import com.clawchat.android.core.ui.ClawTone
import com.clawchat.android.core.ui.ClawTopBarColors
import com.clawchat.android.core.ui.SwipeToDismissCard
import com.clawchat.android.core.ui.TaskCreateSheet
import com.clawchat.android.core.ui.icons.ClawIcons
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TodayScreen(
    viewModel: TodayViewModel = hiltViewModel(),
    showAgentFeatures: Boolean = true,
    onNavigateToInbox: () -> Unit = {},
    onNavigateToReview: () -> Unit = {},
    onNavigateToRuns: () -> Unit = {},
    onNavigateToSearch: () -> Unit = {},
    onNavigateToSettings: () -> Unit = {},
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var showQuickAdd by remember { mutableStateOf(false) }

    val totalTasks = state.todayTodos.size + state.overdueTodos.size + state.needsDateTodos.size
    val completedTasks = (state.todayTodos + state.overdueTodos + state.needsDateTodos).count {
        it.status == TaskStatus.COMPLETED
    }
    val hasContent = (showAgentFeatures && state.briefing != null) ||
        state.overdueTodos.isNotEmpty() ||
        state.todayTodos.isNotEmpty() ||
        state.needsDateTodos.isNotEmpty() ||
        state.todayEvents.isNotEmpty() ||
        (showAgentFeatures && state.inboxPreview.isNotEmpty())

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                navigationIcon = { com.clawchat.android.core.ui.NavigationMenuButton() },
                title = {
                    Text(
                        text = stringResource(R.string.today_title),
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold,
                    )
                },
                actions = {
                    IconButton(onClick = onNavigateToSearch) {
                        Icon(
                            Icons.Default.Search,
                            contentDescription = stringResource(R.string.today_cd_search),
                        )
                    }
                    IconButton(onClick = onNavigateToSettings) {
                        Icon(
                            Icons.Default.Settings,
                            contentDescription = stringResource(R.string.today_cd_settings),
                        )
                    }
                },
                colors = ClawTopBarColors(),
            )
        },
        floatingActionButton = {
            SmallFloatingActionButton(
                modifier = Modifier.size(48.dp),
                onClick = { showQuickAdd = true },
                shape = MaterialTheme.shapes.medium,
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ) {
                Icon(
                    Icons.Default.Add,
                    contentDescription = stringResource(R.string.today_cd_capture_task),
                )
            }
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = state.isRefreshing,
            onRefresh = viewModel::refresh,
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(
                    start = 12.dp,
                    end = 12.dp,
                    top = 4.dp,
                    bottom = 88.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (state.isOffline) {
                    item {
                        ClawStatusChip(
                            text = stringResource(R.string.today_offline_cached),
                            tone = ClawTone.Error,
                        )
                    }
                }

                item {
                    TodayHeroCard(
                        greeting = localizedGreeting(state.greeting),
                        completedTasks = completedTasks,
                        totalTasks = totalTasks,
                        eventCount = state.todayEvents.size,
                        inboxCount = if (showAgentFeatures) state.inboxCount else 0,
                        showInbox = showAgentFeatures,
                        onNavigateToInbox = onNavigateToInbox,
                        onQuickAdd = { showQuickAdd = true },
                    )
                }

                if (showAgentFeatures) {
                    item {
                        AgentControlCard(
                            onNavigateToReview = onNavigateToReview,
                            onNavigateToRuns = onNavigateToRuns,
                        )
                    }
                }

                state.briefing?.takeIf { showAgentFeatures }?.let { briefing ->
                    item {
                        BriefingSection(briefing = briefing)
                    }
                }

                if (state.overdueTodos.isNotEmpty()) {
                    item {
                        TodoSectionCard(
                            title = stringResource(R.string.today_overdue_title),
                            subtitle = stringResource(R.string.today_overdue_subtitle),
                            todos = state.overdueTodos,
                            tone = ClawTone.Error,
                            onToggle = viewModel::toggleComplete,
                            onDelete = viewModel::deleteTask,
                            onSetDueToday = viewModel::setDueToday,
                        )
                    }
                }

                if (state.todayTodos.isNotEmpty()) {
                    item {
                        TodoSectionCard(
                            title = stringResource(R.string.today_focus_title),
                            subtitle = stringResource(R.string.today_focus_subtitle),
                            todos = state.todayTodos,
                            tone = ClawTone.Primary,
                            onToggle = viewModel::toggleComplete,
                            onDelete = viewModel::deleteTask,
                            onSetDueToday = viewModel::setDueToday,
                        )
                    }
                }

                if (state.needsDateTodos.isNotEmpty()) {
                    item {
                        TodoSectionCard(
                            title = stringResource(R.string.today_needs_date_title),
                            subtitle = stringResource(R.string.today_needs_date_subtitle),
                            todos = state.needsDateTodos,
                            tone = ClawTone.Warning,
                            onToggle = viewModel::toggleComplete,
                            onDelete = viewModel::deleteTask,
                            onSetDueToday = viewModel::setDueToday,
                        )
                    }
                }

                if (state.todayEvents.isNotEmpty()) {
                    item {
                        EventSectionCard(events = state.todayEvents)
                    }
                }

                if (showAgentFeatures && state.inboxPreview.isNotEmpty()) {
                    item {
                        InboxPreviewSection(
                            todos = state.inboxPreview,
                            totalInboxCount = state.inboxCount,
                            onNavigateToInbox = onNavigateToInbox,
                        )
                    }
                }

                if (!hasContent && !state.isRefreshing) {
                    item {
                        ClawEmptyState(
                            title = stringResource(R.string.today_empty_title),
                            description = stringResource(
                                if (showAgentFeatures) {
                                    R.string.today_empty_description
                                } else {
                                    R.string.today_empty_description_local
                                },
                            ),
                            icon = {
                                Icon(
                                    Icons.Default.CheckCircle,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary,
                                )
                            },
                            actionLabel = stringResource(R.string.today_empty_action),
                            onActionClick = { showQuickAdd = true },
                        )
                    }
                }
            }
        }
    }

    if (showQuickAdd) {
        TaskCreateSheet(
            onDismiss = { showQuickAdd = false },
            initialDueDate = java.time.LocalDate.now().toString(),
            onCreate = { data ->
                viewModel.createTask(data)
                showQuickAdd = false
            },
        )
    }
}

@Composable
private fun AgentControlCard(
    onNavigateToReview: () -> Unit,
    onNavigateToRuns: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        ClawSectionHeader(
            title = stringResource(R.string.today_agent_activity_title),
            subtitle = stringResource(R.string.today_agent_activity_subtitle),
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            TextButton(
                modifier = Modifier.weight(1f),
                onClick = onNavigateToReview,
            ) {
                Text(stringResource(R.string.today_review_queue))
            }
            TextButton(
                modifier = Modifier.weight(1f),
                onClick = onNavigateToRuns,
            ) {
                Text(stringResource(R.string.today_agent_runs))
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.7f))
    }
}

@Composable
private fun TodayHeroCard(
    greeting: String,
    completedTasks: Int,
    totalTasks: Int,
    eventCount: Int,
    inboxCount: Int,
    showInbox: Boolean,
    onNavigateToInbox: () -> Unit,
    onQuickAdd: () -> Unit,
) {
    val summary = when {
        totalTasks > 0 -> pluralStringResource(
            R.plurals.today_tasks_done_summary,
            totalTasks,
            completedTasks,
            totalTasks,
        )
        eventCount > 0 -> pluralStringResource(
            R.plurals.today_events_summary,
            eventCount,
            eventCount,
        )
        showInbox && inboxCount > 0 -> pluralStringResource(
            R.plurals.today_inbox_summary,
            inboxCount,
            inboxCount,
        )
        showInbox -> stringResource(R.string.today_shape_day_hint)
        else -> stringResource(R.string.today_shape_day_hint_local)
    }
    val taskMetric = pluralStringResource(
        R.plurals.today_metric_tasks,
        totalTasks,
        completedTasks,
        totalTasks,
    )
    val eventMetric = pluralStringResource(
        R.plurals.today_metric_events,
        eventCount,
        eventCount,
    )
    val inboxMetric = pluralStringResource(
        R.plurals.today_metric_inbox,
        inboxCount,
        inboxCount,
    )
    val progressDescription = pluralStringResource(
        R.plurals.today_progress_accessibility,
        totalTasks,
        completedTasks,
        totalTasks,
    )

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            text = greeting,
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = summary,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (totalTasks > 0) {
            LinearProgressIndicator(
                progress = { completedTasks.toFloat() / totalTasks.toFloat() },
                modifier = Modifier
                    .fillMaxWidth()
                    .semantics { contentDescription = progressDescription },
            )
        }
        Text(
            text = if (showInbox) {
                stringResource(
                    R.string.today_metrics_format,
                    taskMetric,
                    eventMetric,
                    inboxMetric,
                )
            } else {
                stringResource(
                    R.string.today_metrics_without_inbox_format,
                    taskMetric,
                    eventMetric,
                )
            },
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            TextButton(
                modifier = Modifier.weight(1f),
                onClick = onQuickAdd,
            ) {
                Text(stringResource(R.string.today_quick_capture))
            }
            if (showInbox) {
                TextButton(
                    modifier = Modifier.weight(1f),
                    onClick = onNavigateToInbox,
                ) {
                    Text(stringResource(R.string.today_open_inbox))
                }
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.7f))
    }
}

@Composable
private fun TodoSectionCard(
    title: String,
    subtitle: String,
    todos: List<Todo>,
    tone: ClawTone,
    onToggle: (String) -> Unit,
    onDelete: (String) -> Unit,
    onSetDueToday: (String) -> Unit,
) {
    ClawListSection(
        tone = tone,
        header = {
            ClawSectionHeader(
                title = title,
                subtitle = subtitle,
                count = todos.size,
            )
        },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
            todos.forEach { todo ->
                SwipeableTodoCard(
                    todo = todo,
                    onToggle = { onToggle(todo.id) },
                    onDelete = { onDelete(todo.id) },
                    onSetDueToday = { onSetDueToday(todo.id) },
                )
            }
        }
    }
}

@Composable
private fun SwipeableTodoCard(
    todo: Todo,
    onToggle: () -> Unit,
    onDelete: () -> Unit,
    onSetDueToday: () -> Unit,
) {
    SwipeToDismissCard(onDelete = onDelete, onSetDueToday = onSetDueToday) {
        TodoRow(todo = todo, onToggle = onToggle)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TodoRow(
    todo: Todo,
    onToggle: () -> Unit,
) {
    val isCompleted = todo.status == TaskStatus.COMPLETED
    val view = LocalView.current
    val checkboxDescription = stringResource(
        if (isCompleted) R.string.today_task_mark_incomplete else R.string.today_task_mark_complete,
        todo.title,
    )

    ClawListItemSurface {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .alpha(if (isCompleted) 0.65f else 1f),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Checkbox(
                checked = isCompleted,
                modifier = Modifier.semantics {
                    contentDescription = checkboxDescription
                },
                onCheckedChange = {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
                    } else {
                        view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                    }
                    onToggle()
                },
            )
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    text = todo.title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                    textDecoration = if (isCompleted) TextDecoration.LineThrough else null,
                )
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    if (todo.status != TaskStatus.PENDING) {
                        ClawStatusChip(
                            text = taskStatusLabel(todo.status),
                            tone = taskStatusTone(todo.status),
                        )
                    }
                    todo.dueDate?.let {
                        ClawStatusChip(
                            text = localizedDateLabel(it),
                            tone = if (todo.status == TaskStatus.COMPLETED) ClawTone.Default else ClawTone.Warning,
                        )
                    }
                    if (todo.isRecurring) {
                        ClawStatusChip(
                            text = stringResource(R.string.today_recurring),
                            tone = ClawTone.Success,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun taskStatusLabel(status: TaskStatus): String = when (status) {
    TaskStatus.PENDING -> stringResource(R.string.today_status_pending)
    TaskStatus.IN_PROGRESS -> stringResource(R.string.today_status_in_progress)
    TaskStatus.COMPLETED -> stringResource(R.string.today_status_completed)
    TaskStatus.CANCELLED -> stringResource(R.string.today_status_cancelled)
}

private fun taskStatusTone(status: TaskStatus): ClawTone = when (status) {
    TaskStatus.PENDING -> ClawTone.Default
    TaskStatus.IN_PROGRESS -> ClawTone.Primary
    TaskStatus.COMPLETED -> ClawTone.Success
    TaskStatus.CANCELLED -> ClawTone.Default
}

@Composable
private fun EventSectionCard(events: List<Event>) {
    ClawListSection(
        header = {
            ClawSectionHeader(
                title = stringResource(R.string.today_calendar_title),
                subtitle = stringResource(R.string.today_calendar_subtitle),
                count = events.size,
            )
        },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
            events.forEach { event ->
                EventRow(event = event)
            }
        }
    }
}

@Composable
private fun EventRow(event: Event) {
    ClawListItemSurface {
        Row(
            modifier = Modifier
                .fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(
                modifier = Modifier.size(36.dp),
                shape = MaterialTheme.shapes.medium,
                color = MaterialTheme.colorScheme.primary.copy(alpha = 0.10f),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        ClawIcons.Today,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
            }
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    text = event.title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                )
                Text(
                    text = localizedEventTimeLabel(event),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            event.reminderMinutes?.let { minutes ->
                ClawStatusChip(
                    text = reminderLabel(minutes),
                    tone = ClawTone.Primary,
                )
            }
        }
    }
}

@Composable
private fun InboxPreviewSection(
    todos: List<Todo>,
    totalInboxCount: Int,
    onNavigateToInbox: () -> Unit,
) {
    ClawListSection(
        tone = ClawTone.Warning,
        header = {
            ClawSectionHeader(
                title = stringResource(R.string.today_needs_review_title),
                subtitle = stringResource(R.string.today_needs_review_subtitle),
                count = totalInboxCount,
                actionLabel = stringResource(R.string.today_open_inbox),
                onActionClick = onNavigateToInbox,
            )
        },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
            todos.forEach { todo ->
                ClawListItemSurface {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Surface(
                            modifier = Modifier.size(40.dp),
                            shape = MaterialTheme.shapes.medium,
                            color = MaterialTheme.colorScheme.primary.copy(alpha = 0.10f),
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(
                                    ClawIcons.Inbox,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary,
                                )
                            }
                        }
                        Column(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(2.dp),
                        ) {
                            Text(
                                text = todo.title,
                                style = MaterialTheme.typography.bodyLarge,
                                fontWeight = FontWeight.Medium,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            val planSummary = todo.planSummary
                            if (!planSummary.isNullOrBlank()) {
                                Text(
                                    text = planSummary,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                        ClawStatusChip(
                            text = when (todo.inboxState) {
                                "plan_ready" -> stringResource(R.string.today_inbox_state_review)
                                else -> stringResource(R.string.today_inbox_state_organize)
                            },
                            tone = ClawTone.Warning,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun BriefingSection(briefing: BriefingResponse) {
    val suggestionCount = briefing.suggestions.size
    ClawListSection(
        header = {
            ClawSectionHeader(
                title = stringResource(R.string.today_briefing_title),
                subtitle = briefing.loadMessage.ifBlank {
                    stringResource(R.string.today_briefing_fallback)
                },
                count = suggestionCount.takeIf { it > 0 },
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                ClawStatusChip(
                    text = loadAssessmentLabel(briefing.loadAssessment),
                    tone = loadTone(briefing.loadAssessment),
                )
                if (briefing.highlights.isNotEmpty()) {
                    ClawStatusChip(
                        text = pluralStringResource(
                            R.plurals.today_highlight_count,
                            briefing.highlights.size,
                            briefing.highlights.size,
                        ),
                        tone = ClawTone.Default,
                    )
                }
            }
            if (briefing.summary.isNotBlank()) {
                Text(
                    text = briefing.summary,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
    ) {
        if (briefing.highlights.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
                briefing.highlights.take(3).forEach { highlight ->
                    ClawListItemSurface {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                ClawIcons.Today,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                            )
                            Text(
                                text = highlight,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                        }
                    }
                }
            }
        }
        if (briefing.suggestions.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
                briefing.suggestions.forEach { suggestion ->
                    SuggestionActionCard(suggestion = suggestion)
                }
            }
        }
    }
}

@Composable
private fun SuggestionActionCard(suggestion: BriefingSuggestion) {
    ClawListItemSurface {
        Row(
            modifier = Modifier
                .fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    text = suggestion.title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (suggestion.reason.isNotBlank()) {
                    Text(
                        text = suggestion.reason,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            ClawStatusChip(
                text = suggestionActionLabel(suggestion.action),
                tone = ClawTone.Primary,
            )
        }
    }
}

@Composable
private fun reminderLabel(minutes: Int): String = when {
    minutes >= 1440 && minutes % 1440 == 0 -> {
        val days = minutes / 1440
        pluralStringResource(R.plurals.today_reminder_days_before, days, days)
    }
    minutes >= 60 && minutes % 60 == 0 -> {
        val hours = minutes / 60
        pluralStringResource(R.plurals.today_reminder_hours_before, hours, hours)
    }
    else -> pluralStringResource(R.plurals.today_reminder_minutes_before, minutes, minutes)
}

@Composable
private fun loadAssessmentLabel(loadAssessment: String): String = when (loadAssessment.lowercase()) {
    "light" -> stringResource(R.string.today_load_light)
    "moderate" -> stringResource(R.string.today_load_moderate)
    "heavy" -> stringResource(R.string.today_load_heavy)
    else -> loadAssessment
}

@Composable
private fun suggestionActionLabel(action: String): String = when (action.lowercase()) {
    "start_with" -> stringResource(R.string.today_suggestion_start_with)
    "move_to_tomorrow" -> stringResource(R.string.today_suggestion_move_to_tomorrow)
    "reschedule" -> stringResource(R.string.today_suggestion_reschedule)
    "archive" -> stringResource(R.string.today_suggestion_archive)
    "break_down" -> stringResource(R.string.today_suggestion_break_down)
    "prioritize" -> stringResource(R.string.today_suggestion_prioritize)
    else -> action.replace('_', ' ')
}

@Composable
private fun localizedGreeting(greeting: String): String = when (greeting.trim().lowercase()) {
    "good morning", "good morning!" -> stringResource(R.string.today_greeting_morning)
    "good afternoon", "good afternoon!" -> stringResource(R.string.today_greeting_afternoon)
    "good evening", "good evening!" -> stringResource(R.string.today_greeting_evening)
    "" -> stringResource(R.string.today_ready_when_you_are)
    else -> greeting
}

@Composable
private fun localizedDateLabel(rawDate: String): String {
    val locale = LocalLocale.current.platformLocale
    return remember(rawDate, locale) {
        runCatching {
            LocalDate.parse(rawDate).format(
                DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale),
            )
        }.getOrDefault(rawDate)
    }
}

@Composable
private fun localizedEventTimeLabel(event: Event): String {
    if (event.isAllDay) return stringResource(R.string.today_event_all_day)
    val locale = LocalLocale.current.platformLocale
    return remember(event.startTime, locale) {
        val time = runCatching {
            OffsetDateTime.parse(event.startTime)
                .atZoneSameInstant(ZoneId.systemDefault())
                .toLocalTime()
        }.recoverCatching {
            LocalDateTime.parse(event.startTime).toLocalTime()
        }.getOrNull()
        time?.format(
            DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale),
        ) ?: event.startTime
    }
}

private fun loadTone(loadAssessment: String): ClawTone = when (loadAssessment) {
    "heavy" -> ClawTone.Error
    "light" -> ClawTone.Success
    else -> ClawTone.Warning
}
