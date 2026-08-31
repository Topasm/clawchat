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
import androidx.compose.ui.platform.LocalView
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TodayScreen(
    viewModel: TodayViewModel = hiltViewModel(),
    onNavigateToInbox: () -> Unit = {},
    onNavigateToReview: () -> Unit = {},
    onNavigateToRuns: () -> Unit = {},
    onNavigateToSearch: () -> Unit = {},
    onNavigateToSettings: () -> Unit = {},
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var showQuickAdd by remember { mutableStateOf(false) }

    val totalTasks = state.todayTodos.size + state.overdueTodos.size
    val completedTasks = (state.todayTodos + state.overdueTodos).count {
        it.status == TaskStatus.COMPLETED
    }
    val hasContent = state.briefing != null ||
        state.overdueTodos.isNotEmpty() ||
        state.todayTodos.isNotEmpty() ||
        state.todayEvents.isNotEmpty() ||
        state.inboxPreview.isNotEmpty()

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "Today",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold,
                    )
                },
                actions = {
                    IconButton(onClick = onNavigateToSearch) {
                        Icon(
                            Icons.Default.Search,
                            contentDescription = "Search",
                        )
                    }
                    IconButton(onClick = onNavigateToSettings) {
                        Icon(
                            Icons.Default.Settings,
                            contentDescription = "Settings",
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
                Icon(Icons.Default.Add, contentDescription = "Capture task")
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
                            text = "Offline — showing the last synced day",
                            tone = ClawTone.Error,
                        )
                    }
                }

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

                item {
                    AgentControlCard(
                        onNavigateToReview = onNavigateToReview,
                        onNavigateToRuns = onNavigateToRuns,
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
            title = "Agent activity",
            subtitle = "Review decisions or check active runs.",
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            TextButton(
                modifier = Modifier.weight(1f),
                onClick = onNavigateToReview,
            ) {
                Text("Review queue")
            }
            TextButton(
                modifier = Modifier.weight(1f),
                onClick = onNavigateToRuns,
            ) {
                Text("Agent runs")
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
    onNavigateToInbox: () -> Unit,
    onQuickAdd: () -> Unit,
) {
    val summary = when {
        totalTasks > 0 -> "$completedTasks of $totalTasks tasks done today"
        eventCount > 0 -> "$eventCount event${if (eventCount == 1) "" else "s"} on the calendar"
        inboxCount > 0 -> "$inboxCount item${if (inboxCount == 1) "" else "s"} waiting in Inbox"
        else -> "Use chat or quick capture to shape the rest of your day."
    }

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
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Text(
            text = "$completedTasks/$totalTasks tasks  ·  $eventCount events  ·  $inboxCount inbox",
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
                Text("Quick capture")
            }
            TextButton(
                modifier = Modifier.weight(1f),
                onClick = onNavigateToInbox,
            ) {
                Text("Open inbox")
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
                    PriorityChip(todo.priority)
                    todo.dueDate?.let {
                        ClawStatusChip(
                            text = it,
                            tone = if (todo.status == TaskStatus.COMPLETED) ClawTone.Default else ClawTone.Warning,
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

private fun taskStatusLabel(status: TaskStatus): String = when (status) {
    TaskStatus.PENDING -> "Pending"
    TaskStatus.IN_PROGRESS -> "In progress"
    TaskStatus.COMPLETED -> "Completed"
    TaskStatus.CANCELLED -> "Cancelled"
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
                title = "Calendar",
                subtitle = "What the rest of the day is anchored around.",
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
                    text = event.startTime,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                val location = event.location
                if (!location.isNullOrBlank()) {
                    Text(
                        text = location,
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
    ClawListSection(
        tone = ClawTone.Warning,
        header = {
            ClawSectionHeader(
                title = "Needs review",
                subtitle = "Captured items waiting for your decision.",
                count = totalInboxCount,
                actionLabel = "Open inbox",
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
    ClawListSection(
        header = {
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
