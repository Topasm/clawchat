package com.clawchat.android.feature.today

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.clawchat.android.core.data.model.BriefingResponse
import com.clawchat.android.core.data.model.BriefingSuggestion
import com.clawchat.android.core.data.model.Event
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.ui.SwipeToDismissCard

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TodayScreen(
    viewModel: TodayViewModel = hiltViewModel(),
    onNavigateToInbox: () -> Unit = {},
    onNavigateToSettings: () -> Unit = {},
) {
    val state by viewModel.uiState.collectAsState()
    var showQuickAdd by remember { mutableStateOf(false) }
    var quickAddText by remember { mutableStateOf("") }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(state.greeting.ifBlank { "Today" }) },
                actions = {
                    IconButton(onClick = onNavigateToSettings) {
                        Icon(
                            Icons.Default.Settings,
                            contentDescription = "Settings",
                            modifier = Modifier.size(22.dp),
                        )
                    }
                },
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { showQuickAdd = true }) {
                Icon(Icons.Default.Add, contentDescription = "Quick add")
            }
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = state.isRefreshing,
            onRefresh = viewModel::refresh,
            modifier = Modifier.padding(padding),
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                // Briefing section
                val briefing = state.briefing
                if (briefing != null) {
                    item(key = "briefing") {
                        BriefingSection(briefing = briefing)
                    }
                    item { Spacer(Modifier.height(8.dp)) }
                } else if (state.isBriefingLoading) {
                    item(key = "briefing-loading") {
                        Box(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            CircularProgressIndicator(modifier = Modifier.size(24.dp))
                        }
                    }
                }

                // Overdue section
                if (state.overdueTodos.isNotEmpty()) {
                    item {
                        Text(
                            "Overdue",
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                    items(state.overdueTodos, key = { it.id }) { todo ->
                        SwipeableTodoCard(
                            todo = todo,
                            onToggle = { viewModel.toggleComplete(todo.id) },
                            onDelete = { viewModel.deleteTask(todo.id) },
                            onSetDueToday = { viewModel.setDueToday(todo.id) },
                        )
                    }
                    item { Spacer(Modifier.height(8.dp)) }
                }

                // Today tasks
                if (state.todayTodos.isNotEmpty()) {
                    item {
                        Text("Tasks", style = MaterialTheme.typography.titleSmall)
                    }
                    items(state.todayTodos, key = { it.id }) { todo ->
                        SwipeableTodoCard(
                            todo = todo,
                            onToggle = { viewModel.toggleComplete(todo.id) },
                            onDelete = { viewModel.deleteTask(todo.id) },
                            onSetDueToday = { viewModel.setDueToday(todo.id) },
                        )
                    }
                    item { Spacer(Modifier.height(8.dp)) }
                }

                // Events
                if (state.todayEvents.isNotEmpty()) {
                    item {
                        Text("Events", style = MaterialTheme.typography.titleSmall)
                    }
                    items(state.todayEvents, key = { it.id }) { event ->
                        EventCard(event = event)
                    }
                    item { Spacer(Modifier.height(8.dp)) }
                }

                // Needs review section (inbox preview)
                if (state.inboxPreview.isNotEmpty()) {
                    item {
                        Text("Needs review", style = MaterialTheme.typography.titleSmall)
                    }
                    items(state.inboxPreview, key = { "inbox-${it.id}" }) { todo ->
                        InboxPreviewCard(todo = todo)
                    }
                    item {
                        TextButton(
                            onClick = onNavigateToInbox,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("See all in Inbox")
                            Spacer(Modifier.width(4.dp))
                            Icon(
                                Icons.Default.ArrowForward,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp),
                            )
                        }
                    }
                }

                // Empty state
                if (state.todayTodos.isEmpty() && state.overdueTodos.isEmpty() && state.todayEvents.isEmpty() && state.inboxPreview.isEmpty() && !state.isRefreshing) {
                    item {
                        Box(
                            modifier = Modifier.fillParentMaxSize(),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                "All clear for today!",
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }
    }

    // Quick add dialog
    if (showQuickAdd) {
        AlertDialog(
            onDismissRequest = { showQuickAdd = false; quickAddText = "" },
            title = { Text("Quick Add Task") },
            text = {
                OutlinedTextField(
                    value = quickAddText,
                    onValueChange = { quickAddText = it },
                    placeholder = { Text("Task title...") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.quickAdd(quickAddText)
                    quickAddText = ""
                    showQuickAdd = false
                }) { Text("Add") }
            },
            dismissButton = {
                TextButton(onClick = { showQuickAdd = false; quickAddText = "" }) { Text("Cancel") }
            },
        )
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
        TodoCard(todo = todo, onToggle = onToggle)
    }
}

@Composable
private fun TodoCard(todo: Todo, onToggle: () -> Unit) {
    val isCompleted = todo.status == "completed"

    ElevatedCard(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Checkbox(checked = isCompleted, onCheckedChange = { onToggle() })
            Spacer(Modifier.width(8.dp))
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        todo.title,
                        style = MaterialTheme.typography.bodyLarge,
                        textDecoration = if (isCompleted) TextDecoration.LineThrough else null,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (todo.isRecurring) {
                        Spacer(Modifier.width(4.dp))
                        Icon(
                            imageVector = Icons.Default.Repeat,
                            contentDescription = "Recurring",
                            modifier = Modifier.size(14.dp),
                            tint = MaterialTheme.colorScheme.primary,
                        )
                    }
                }
                val dueDate = todo.dueDate
                if (dueDate != null) {
                    Text(
                        dueDate,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            PriorityChip(todo.priority)
        }
    }
}

@Composable
private fun EventCard(event: Event) {
    ElevatedCard(modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(event.title, style = MaterialTheme.typography.bodyLarge)
                Text(
                    event.startTime,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                event.location?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            event.reminderMinutes?.let { minutes ->
                val label = when (minutes) {
                    5 -> "5m"
                    10 -> "10m"
                    15 -> "15m"
                    30 -> "30m"
                    60 -> "1h"
                    120 -> "2h"
                    1440 -> "1d"
                    else -> "${minutes}m"
                }
                SuggestionChip(
                    onClick = {},
                    label = { Text(label, style = MaterialTheme.typography.labelSmall) },
                    colors = SuggestionChipDefaults.suggestionChipColors(
                        labelColor = MaterialTheme.colorScheme.primary,
                    ),
                )
            }
        }
    }
}

@Composable
private fun InboxPreviewCard(todo: Todo) {
    val stateLabel = when (todo.inboxState) {
        "plan_ready" -> "Review"
        "captured" -> "Organize"
        else -> todo.inboxState ?: ""
    }

    ElevatedCard(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    todo.title,
                    style = MaterialTheme.typography.bodyLarge,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                val summary = todo.planSummary
                if (!summary.isNullOrBlank()) {
                    Text(
                        summary,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Spacer(Modifier.width(8.dp))
            SuggestionChip(
                onClick = {},
                label = { Text(stateLabel, style = MaterialTheme.typography.labelSmall) },
                colors = SuggestionChipDefaults.suggestionChipColors(
                    labelColor = MaterialTheme.colorScheme.tertiary,
                ),
            )
        }
    }
}

@Composable
private fun BriefingSection(briefing: BriefingResponse) {
    ElevatedCard(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            // Load assessment badge + title
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text("Daily Briefing", style = MaterialTheme.typography.titleSmall)
                LoadAssessmentChip(briefing.loadAssessment)
            }

            // Summary text
            if (briefing.summary.isNotBlank()) {
                Spacer(Modifier.height(8.dp))
                Text(
                    briefing.summary,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            // Load message
            if (briefing.loadMessage.isNotBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(
                    briefing.loadMessage,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            // Highlights
            if (briefing.highlights.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                briefing.highlights.forEach { highlight ->
                    Text(
                        "\u2022 $highlight",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            // Suggestion cards
            if (briefing.suggestions.isNotEmpty()) {
                Spacer(Modifier.height(12.dp))
                Text("Suggestions", style = MaterialTheme.typography.labelMedium)
                Spacer(Modifier.height(4.dp))
                briefing.suggestions.forEach { suggestion ->
                    SuggestionActionCard(suggestion = suggestion)
                    Spacer(Modifier.height(4.dp))
                }
            }
        }
    }
}

@Composable
private fun LoadAssessmentChip(loadAssessment: String) {
    val (label, color) = when (loadAssessment) {
        "light" -> "Light" to Color(0xFF4CAF50)
        "heavy" -> "Heavy" to MaterialTheme.colorScheme.error
        else -> "Moderate" to Color(0xFFFFA726)
    }
    SuggestionChip(
        onClick = {},
        label = { Text(label, style = MaterialTheme.typography.labelSmall) },
        colors = SuggestionChipDefaults.suggestionChipColors(
            containerColor = color.copy(alpha = 0.12f),
            labelColor = color,
        ),
    )
}

@Composable
private fun SuggestionActionCard(suggestion: BriefingSuggestion) {
    OutlinedCard(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    suggestion.title,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (suggestion.reason.isNotBlank()) {
                    Text(
                        suggestion.reason,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Spacer(Modifier.width(8.dp))
            SuggestionChip(
                onClick = {},
                label = {
                    Text(
                        suggestion.action.replaceFirstChar { it.uppercase() },
                        style = MaterialTheme.typography.labelSmall,
                    )
                },
            )
        }
    }
}

@Composable
private fun PriorityChip(priority: String) {
    val color = when (priority) {
        "high" -> MaterialTheme.colorScheme.error
        "medium" -> MaterialTheme.colorScheme.tertiary
        else -> MaterialTheme.colorScheme.outline
    }
    SuggestionChip(
        onClick = {},
        label = { Text(priority, style = MaterialTheme.typography.labelSmall) },
        colors = SuggestionChipDefaults.suggestionChipColors(labelColor = color),
    )
}
