package com.clawchat.android.feature.tasks

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DragHandle
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import android.os.Build
import android.view.HapticFeedbackConstants
import androidx.hilt.navigation.compose.hiltViewModel
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.ui.TaskCreateSheet
import com.clawchat.android.core.ui.performTaskToggleHaptic
import com.clawchat.android.core.ui.rememberTaskCompletionUiState
import com.clawchat.android.core.ui.SwipeToDismissCard
import java.time.LocalDate
import sh.calvin.reorderable.ReorderableItem
import sh.calvin.reorderable.rememberReorderableLazyListState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TasksScreen(
    viewModel: TasksViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()

    if (state.selectedTask != null) {
        TaskDetailView(
            task = state.selectedTask!!,
            onBack = { viewModel.selectTask(null) },
            onToggle = { viewModel.toggleComplete(state.selectedTask!!.id) },
            onDelete = { viewModel.deleteTask(state.selectedTask!!.id) },
        )
    } else {
        TaskListView(
            tasks = state.tasks,
            isLoading = state.isLoading,
            statusFilter = state.statusFilter,
            onSelect = viewModel::selectTask,
            onToggle = viewModel::toggleComplete,
            onDelete = viewModel::deleteTask,
            onSetDueToday = viewModel::setDueToday,
            onSetFilter = viewModel::setStatusFilter,
            onRefresh = viewModel::loadTasks,
            onCreate = viewModel::createTask,
            onReorder = viewModel::reorderTasks,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TaskListView(
    tasks: List<Todo>,
    isLoading: Boolean,
    statusFilter: String?,
    onSelect: (Todo) -> Unit,
    onToggle: (String) -> Unit,
    onDelete: (String) -> Unit,
    onSetDueToday: (String) -> Unit,
    onSetFilter: (String?) -> Unit,
    onRefresh: () -> Unit,
    onCreate: (TodoCreate) -> Unit,
    onReorder: (List<Todo>) -> Unit,
) {
    var showCreateSheet by remember { mutableStateOf(false) }

    Scaffold(
        topBar = { TopAppBar(title = { Text("Tasks") }) },
        floatingActionButton = {
            FloatingActionButton(onClick = { showCreateSheet = true }) {
                Icon(Icons.Default.Add, contentDescription = "New task")
            }
        },
    ) { padding ->
        Column(modifier = Modifier.padding(padding)) {
            // Filter chips
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                FilterChip(
                    selected = statusFilter == null,
                    onClick = { onSetFilter(null) },
                    label = { Text("All") },
                )
                FilterChip(
                    selected = statusFilter == "pending",
                    onClick = { onSetFilter("pending") },
                    label = { Text("Pending") },
                )
                FilterChip(
                    selected = statusFilter == "completed",
                    onClick = { onSetFilter("completed") },
                    label = { Text("Done") },
                )
            }

            // Filter out tasks that belong in the Inbox (inbox_state != "none" and not null)
            val filteredTasks = tasks.filter { task ->
                val state = task.inboxState
                state == null || state == "none"
            }

            if (isLoading && tasks.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            } else {
                val reorderView = LocalView.current
                val lazyListState = rememberLazyListState()
                val reorderableState = rememberReorderableLazyListState(lazyListState) { from, to ->
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                        reorderView.performHapticFeedback(HapticFeedbackConstants.SEGMENT_FREQUENT_TICK)
                    } else {
                        reorderView.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                    }
                    val reordered = filteredTasks.toMutableList().apply {
                        add(to.index, removeAt(from.index))
                    }
                    onReorder(reordered.mapIndexed { index, task -> task.copy(sortOrder = index) })
                }

                LazyColumn(
                    state = lazyListState,
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(filteredTasks, key = { it.id }) { task ->
                        ReorderableItem(reorderableState, key = task.id) {
                            SwipeableTaskRow(
                                task = task,
                                onToggle = { onToggle(task.id) },
                                onDelete = { onDelete(task.id) },
                                onSetDueToday = if (task.isDueToday()) null else { { onSetDueToday(task.id) } },
                                onClick = { onSelect(task) },
                                dragModifier = Modifier.draggableHandle(),
                            )
                        }
                    }
                }
            }
        }
    }

    if (showCreateSheet) {
        TaskCreateSheet(
            onDismiss = { showCreateSheet = false },
            onCreate = { input ->
                onCreate(input.asQuickCaptureTodoCreate())
                showCreateSheet = false
            },
        )
    }
}

@Composable
private fun SwipeableTaskRow(
    task: Todo,
    onToggle: () -> Unit,
    onDelete: () -> Unit,
    onSetDueToday: (() -> Unit)?,
    onClick: () -> Unit,
    dragModifier: Modifier = Modifier,
) {
    SwipeToDismissCard(onDelete = onDelete, onSetDueToday = onSetDueToday) {
        TaskRow(task = task, onToggle = onToggle, onClick = onClick, dragModifier = dragModifier)
    }
}

@Composable
private fun TaskRow(task: Todo, onToggle: () -> Unit, onClick: () -> Unit, dragModifier: Modifier = Modifier) {
    val isCompleted = task.status == "completed"
    val view = LocalView.current
    val completionUi = rememberTaskCompletionUiState(isCompleted)

    ElevatedCard(modifier = Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Row(modifier = Modifier.padding(12.dp).alpha(completionUi.alpha), verticalAlignment = Alignment.CenterVertically) {
            Icon(
                Icons.Default.DragHandle,
                contentDescription = "Reorder",
                modifier = dragModifier,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.width(4.dp))
            Checkbox(checked = isCompleted, onCheckedChange = {
                performTaskToggleHaptic(view)
                onToggle()
            })
            Spacer(Modifier.width(8.dp))
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        task.title,
                        style = MaterialTheme.typography.bodyLarge,
                        textDecoration = completionUi.textDecoration,
                        color = completionUi.titleColor,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (task.isRecurring) {
                        Spacer(Modifier.width(4.dp))
                        Icon(
                            imageVector = Icons.Default.Repeat,
                            contentDescription = "Recurring",
                            modifier = Modifier.size(14.dp),
                            tint = MaterialTheme.colorScheme.primary,
                        )
                    }
                }
                val desc = task.description
                if (!desc.isNullOrBlank()) {
                    Text(
                        desc,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            // Show inbox state badge when applicable
            val inboxLabel = inboxStateLabel(task.inboxState)
            if (inboxLabel != null) {
                Spacer(Modifier.width(8.dp))
                SuggestionChip(
                    onClick = {},
                    label = { Text(inboxLabel, style = MaterialTheme.typography.labelSmall) },
                    colors = SuggestionChipDefaults.suggestionChipColors(
                        labelColor = MaterialTheme.colorScheme.tertiary,
                    ),
                )
            }
        }
    }
}

private fun inboxStateLabel(inboxState: String?): String? {
    return when (inboxState) {
        null, "none" -> null
        "classifying", "planning" -> "Planning"
        "plan_ready" -> "Review"
        "captured" -> "Organize"
        "error" -> "Failed"
        else -> inboxState.replaceFirstChar { it.uppercase() }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TaskDetailView(
    task: Todo,
    onBack: () -> Unit,
    onToggle: () -> Unit,
    onDelete: () -> Unit,
) {
    val view = LocalView.current
    val completionUi = rememberTaskCompletionUiState(task.status == "completed")

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Task Detail") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { onDelete(); onBack() }) {
                        Icon(Icons.Default.Delete, contentDescription = "Delete", tint = MaterialTheme.colorScheme.error)
                    }
                },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
            Text(
                task.title,
                style = MaterialTheme.typography.headlineSmall,
                color = completionUi.titleColor,
                textDecoration = completionUi.textDecoration,
                modifier = Modifier.alpha(completionUi.alpha),
            )
            Spacer(Modifier.height(8.dp))

            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(
                    checked = task.status == "completed",
                    onCheckedChange = {
                        performTaskToggleHaptic(view)
                        onToggle()
                    },
                )
                Text(
                    if (task.status == "completed") "Completed" else "Pending",
                    color = completionUi.titleColor,
                )
            }

            Spacer(Modifier.height(16.dp))

            Column(modifier = Modifier.alpha(completionUi.alpha)) {
                val detailDesc = task.description
                if (!detailDesc.isNullOrBlank()) {
                    Text("Description", style = MaterialTheme.typography.titleSmall)
                    Spacer(Modifier.height(4.dp))
                    Text(detailDesc, style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.height(16.dp))
                }

                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Column {
                        Text("Priority", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(task.priority)
                    }
                    task.dueDate?.let {
                        Column {
                            Text("Due", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(it)
                        }
                    }
                }

                val taskTags = task.tags
                if (!taskTags.isNullOrEmpty()) {
                    Spacer(Modifier.height(16.dp))
                    Text("Tags", style = MaterialTheme.typography.titleSmall)
                    Spacer(Modifier.height(4.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        taskTags.forEach { tag ->
                            SuggestionChip(onClick = {}, label = { Text(tag) })
                        }
                    }
                }
            }
        }
    }
}

private fun Todo.isDueToday(): Boolean {
    val today = LocalDate.now().toString()
    return dueDate?.startsWith(today) == true
}

private fun TodoCreate.asQuickCaptureTodoCreate(): TodoCreate =
    copy(source = "quick_capture", inboxState = "classifying")
