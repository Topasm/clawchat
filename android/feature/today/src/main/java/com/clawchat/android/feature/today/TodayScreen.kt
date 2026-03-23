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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Event
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.PullToRefreshBox
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.clawchat.android.core.data.model.BriefingResponse
import com.clawchat.android.core.data.model.BriefingSuggestion
import com.clawchat.android.core.data.model.Event
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.ui.ClawEmptyState
import com.clawchat.android.core.ui.ClawMetricPill
import com.clawchat.android.core.ui.ClawSectionCard
import com.clawchat.android.core.ui.ClawSectionHeader
import com.clawchat.android.core.ui.ClawStatusChip
import com.clawchat.android.core.ui.ClawTone
import com.clawchat.android.core.ui.ClawTopBarTitle
import com.clawchat.android.core.ui.SwipeToDismissCard
import com.clawchat.android.core.ui.TaskCreateSheet

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TodayScreen(
    viewModel: TodayViewModel = hiltViewModel(),
    onNavigateToInbox: () -> Unit = {},
    onNavigateToSettings: () -> Unit = {},
) {
    val state by viewModel.uiState.collectAsState()
    var showQuickAdd by remember { mutableStateOf(false) }

    val totalTasks = state.todayTodos.size + state.overdueTodos.size
    val completedTasks = (state.todayTodos + state.overdueTodos).count { it.status == "completed" }
    val hasContent = state.briefing != null ||
        state.overdueTodos.isNotEmpty() ||
        state.todayTodos.isNotEmpty() ||
        state.todayEvents.isNotEmpty() ||
        state.inboxPreview.isNotEmpty()

    Scaffold(
        topBar = {
            LargeTopAppBar(
                title = {
                    ClawTopBarTitle(
                        title = "Today",
                        subtitle = if (state.greeting.isBlank()) null else state.greeting,
                    )
                },
                actions = {
                    IconButton(onClick = onNavigateToSettings) {
                        Icon(
                            Icons.Default.Settings,
                            contentDescription = "Settings",
                        )
                    }
                },
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                modifier = Modifier.navigationBarsPadding(),
                onClick = { showQuickAdd = true },
                icon = { Icon(Icons.Default.Add, contentDescription = null) },
                text = { Text("Capture") },
            )
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
                    start = 16.dp,
                    end = 16.dp,
                    top = 8.dp,
                    bottom = 120.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                item {
                    TodayHeroCard(
                        greeting = state.greeting.ifBlank { "Ready when you are" },
                        completedTasks = completedTasks,
                        totalTasks = totalTasks,
                        eventCount = state.todayEvents.size,
                        inboxCount = state.inboxCount,
                        onNavigateToInbox = onNavigateToInbox,
                        onQuickAdd = { showQuickAdd = true },
                    )
                }

                state.briefing?.let { briefing ->
                    item {
                        BriefingSection(briefing = briefing)
                    }
                }

                if (state.overdueTodos.isNotEmpty()) {
                    item {
                        TodoSectionCard(
                            title = "Overdue",
                            subtitle = "Start with the items already slipping.",
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
                            title = "Today's focus",
                            subtitle = "The main work to close out today.",
                            todos = state.todayTodos,
                            tone = ClawTone.Primary,
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

                if (state.inboxPreview.isNotEmpty()) {
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
                            title = "All clear for today",
                            description = "Ask ClawChat for a plan or capture something new when it comes up.",
                            icon = {
                                Icon(
                                    Icons.Default.CheckCircle,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary,
                                )
                            },
                            actionLabel = "Capture a task",
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
            onCreate = { data ->
                viewModel.quickAdd(data.title)
                showQuickAdd = false
            },
        )
    }
}

@Composable
private fun TodayHeroCard(
    greeting: String,
    completedTasks: Int,
    totalTasks: Int,
    eventCount: Int,
    inboxCount: Int,
    onNavigateToInbox: () -> Unit,
    onQuickAdd: () -> Unit,
) {
    val summary = when {
        totalTasks > 0 -> "$completedTasks of $totalTasks tasks done today"
        eventCount > 0 -> "$eventCount event${if (eventCount == 1) "" else "s"} on the calendar"
        inboxCount > 0 -> "$inboxCount item${if (inboxCount == 1) "" else "s"} waiting in Inbox"
        else -> "Use chat or quick capture to shape the rest of your day."
    }

    ClawSectionCard(tone = ClawTone.Primary) {
        Text(
            text = greeting,
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = summary,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.82f),
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            ClawMetricPill(
                label = "Tasks",
                value = "$completedTasks/$totalTasks",
                modifier = Modifier.weight(1f),
            )
            ClawMetricPill(
                label = "Events",
                value = eventCount.toString(),
                modifier = Modifier.weight(1f),
            )
            ClawMetricPill(
                label = "Inbox",
                value = inboxCount.toString(),
                modifier = Modifier.weight(1f),
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            FilledTonalButton(
                modifier = Modifier.weight(1f),
                onClick = onQuickAdd,
            ) {
                Text("Quick capture")
            }
            OutlinedButton(
                modifier = Modifier.weight(1f),
                onClick = onNavigateToInbox,
            ) {
                Text("Review inbox")
            }
        }
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
    ClawSectionCard(tone = tone) {
        ClawSectionHeader(
            title = title,
            subtitle = subtitle,
            count = todos.size,
        )
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            todos.forEachIndexed { index, todo ->
                SwipeableTodoCard(
                    todo = todo,
                    onToggle = { onToggle(todo.id) },
                    onDelete = { onDelete(todo.id) },
                    onSetDueToday = { onSetDueToday(todo.id) },
                )
                if (index != todos.lastIndex) {
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.65f))
                }
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
    val isCompleted = todo.status == "completed"
    val view = LocalView.current

    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = MaterialTheme.shapes.large,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 14.dp)
                .alpha(if (isCompleted) 0.65f else 1f),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Checkbox(
                checked = isCompleted,
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
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    text = todo.title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                    textDecoration = if (isCompleted) TextDecoration.LineThrough else null,
                )
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    PriorityChip(todo.priority)
                    todo.dueDate?.let {
                        ClawStatusChip(
                            text = it,
                            tone = if (todo.status == "completed") ClawTone.Default else ClawTone.Warning,
                        )
                    }
                    if (todo.isRecurring) {
                        ClawStatusChip(
                            text = "Recurring",
                            tone = ClawTone.Success,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun EventSectionCard(events: List<Event>) {
    ClawSectionCard {
        ClawSectionHeader(
            title = "Calendar",
            subtitle = "What the rest of the day is anchored around.",
            count = events.size,
        )
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            events.forEachIndexed { index, event ->
                EventRow(event = event)
                if (index != events.lastIndex) {
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.65f))
                }
            }
        }
    }
}

@Composable
private fun EventRow(event: Event) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = MaterialTheme.shapes.large,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(
                modifier = Modifier.size(44.dp),
                shape = MaterialTheme.shapes.medium,
                color = MaterialTheme.colorScheme.primaryContainer,
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        Icons.Default.Event,
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
                    text = event.startTime,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (!event.location.isNullOrBlank()) {
                    Text(
                        text = event.location,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
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
    ClawSectionCard(tone = ClawTone.Warning) {
        ClawSectionHeader(
            title = "Needs review",
            subtitle = "Captured items waiting for your decision.",
            count = totalInboxCount,
            actionLabel = "Open inbox",
            onActionClick = onNavigateToInbox,
        )
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            todos.forEach { todo ->
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = MaterialTheme.shapes.large,
                    color = MaterialTheme.colorScheme.surface,
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 14.dp, vertical = 14.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Surface(
                            modifier = Modifier.size(40.dp),
                            shape = MaterialTheme.shapes.medium,
                            color = MaterialTheme.colorScheme.tertiaryContainer,
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(
                                    Icons.Default.Inbox,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.tertiary,
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
                            if (!todo.planSummary.isNullOrBlank()) {
                                Text(
                                    text = todo.planSummary,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                        ClawStatusChip(
                            text = when (todo.inboxState) {
                                "plan_ready" -> "Review"
                                else -> "Organize"
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
    ClawSectionCard {
        ClawSectionHeader(
            title = "Daily briefing",
            subtitle = briefing.loadMessage.ifBlank { "AI summary for the day ahead." },
            count = suggestionCount.takeIf { it > 0 },
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ClawStatusChip(
                text = briefing.loadAssessment.replaceFirstChar { it.uppercase() },
                tone = loadTone(briefing.loadAssessment),
            )
            if (briefing.highlights.isNotEmpty()) {
                ClawStatusChip(
                    text = "${briefing.highlights.size} highlight${if (briefing.highlights.size == 1) "" else "s"}",
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
        if (briefing.highlights.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                briefing.highlights.take(3).forEach { highlight ->
                    Surface(
                        color = MaterialTheme.colorScheme.surface,
                        shape = MaterialTheme.shapes.large,
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                Icons.Default.CalendarToday,
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
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                briefing.suggestions.forEach { suggestion ->
                    SuggestionActionCard(suggestion = suggestion)
                }
            }
        }
    }
}

@Composable
private fun SuggestionActionCard(suggestion: BriefingSuggestion) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = MaterialTheme.shapes.large,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
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
                text = suggestion.action.replaceFirstChar { it.uppercase() },
                tone = ClawTone.Primary,
            )
        }
    }
}

@Composable
private fun PriorityChip(priority: String) {
    val tone = when (priority.lowercase()) {
        "high", "urgent" -> ClawTone.Error
        "medium" -> ClawTone.Warning
        else -> ClawTone.Default
    }
    ClawStatusChip(
        text = priority.replaceFirstChar { it.uppercase() },
        tone = tone,
    )
}

private fun reminderLabel(minutes: Int): String = when (minutes) {
    5 -> "5m"
    10 -> "10m"
    15 -> "15m"
    30 -> "30m"
    60 -> "1h"
    120 -> "2h"
    1440 -> "1d"
    else -> "${minutes}m"
}

private fun loadTone(loadAssessment: String): ClawTone = when (loadAssessment) {
    "heavy" -> ClawTone.Error
    "light" -> ClawTone.Success
    else -> ClawTone.Warning
}
