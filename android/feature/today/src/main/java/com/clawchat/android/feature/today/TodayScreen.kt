package com.clawchat.android.feature.today

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Delete
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
import com.clawchat.android.core.data.model.Event
import com.clawchat.android.core.data.model.Todo

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TodayScreen(
    viewModel: TodayViewModel = hiltViewModel(),
    onNavigateToInbox: () -> Unit = {},
) {
    val state by viewModel.uiState.collectAsState()
    var showQuickAdd by remember { mutableStateOf(false) }
    var quickAddText by remember { mutableStateOf("") }

    Scaffold(
        topBar = {
            TopAppBar(title = { Text(state.greeting.ifBlank { "Today" }) })
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SwipeableTodoCard(
    todo: Todo,
    onToggle: () -> Unit,
    onDelete: () -> Unit,
    onSetDueToday: () -> Unit,
) {
    val dismissState = rememberSwipeToDismissBoxState(
        confirmValueChange = { value ->
            when (value) {
                SwipeToDismissBoxValue.EndToStart -> { onDelete(); true }
                SwipeToDismissBoxValue.StartToEnd -> { onSetDueToday(); false }
                SwipeToDismissBoxValue.Settled -> false
            }
        },
    )

    SwipeToDismissBox(
        state = dismissState,
        backgroundContent = { SwipeBackground(dismissState) },
        enableDismissFromEndToStart = true,
        enableDismissFromStartToEnd = true,
    ) {
        TodoCard(todo = todo, onToggle = onToggle)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SwipeBackground(dismissState: SwipeToDismissBoxState) {
    val color by animateColorAsState(
        when (dismissState.targetValue) {
            SwipeToDismissBoxValue.EndToStart -> Color(0xFFFF3B30)
            SwipeToDismissBoxValue.StartToEnd -> Color(0xFF007AFF)
            SwipeToDismissBoxValue.Settled -> Color.Transparent
        },
        label = "swipe_bg_color",
    )
    val alignment = when (dismissState.dismissDirection) {
        SwipeToDismissBoxValue.EndToStart -> Alignment.CenterEnd
        SwipeToDismissBoxValue.StartToEnd -> Alignment.CenterStart
        else -> Alignment.Center
    }
    val icon = when (dismissState.dismissDirection) {
        SwipeToDismissBoxValue.EndToStart -> Icons.Default.Delete
        SwipeToDismissBoxValue.StartToEnd -> Icons.Default.DateRange
        else -> null
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(color, RoundedCornerShape(12.dp))
            .padding(horizontal = 20.dp),
        contentAlignment = alignment,
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = Color.White)
        }
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
                Text(
                    todo.title,
                    style = MaterialTheme.typography.bodyLarge,
                    textDecoration = if (isCompleted) TextDecoration.LineThrough else null,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
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
