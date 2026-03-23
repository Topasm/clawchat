package com.clawchat.android.feature.tasks

import android.os.Build
import android.view.HapticFeedbackConstants
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DragHandle
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.MaterialTheme
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
import sh.calvin.reorderable.ReorderableItem
import sh.calvin.reorderable.rememberReorderableLazyListState

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
            onCreate = { title -> viewModel.createTask(title) },
            onReorder = viewModel::reorderTasks,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
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
    onCreate: (String) -> Unit,
    onReorder: (List<Todo>) -> Unit,
) {
    var showCreateSheet by remember { mutableStateOf(false) }

    val filteredTasks = tasks.filter { task ->
        val inboxState = task.inboxState
        inboxState == null || inboxState == "none"
    }
    val completedCount = filteredTasks.count { it.status == "completed" }

    Scaffold(
        topBar = {
            LargeTopAppBar(
                title = {
                    ClawTopBarTitle(
                        title = "Tasks",
                        subtitle = "Keep active work readable and reorderable.",
                    )
                },
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                modifier = Modifier.navigationBarsPadding(),
                onClick = { showCreateSheet = true },
                icon = { Icon(Icons.Default.Add, contentDescription = null) },
                text = { Text("New task") },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            TaskSummaryCard(
                totalCount = filteredTasks.size,
                completedCount = completedCount,
                statusFilter = statusFilter,
                onSetFilter = onSetFilter,
            )

            if (isLoading && filteredTasks.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = "Loading tasks...",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else if (filteredTasks.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(horizontal = 16.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    ClawEmptyState(
                        title = "No tasks in this view",
                        description = "Create something new or switch filters to revisit completed work.",
                        actionLabel = "Create task",
                        onActionClick = { showCreateSheet = true },
                    )
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
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 112.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(filteredTasks, key = { it.id }) { task ->
                        ReorderableItem(reorderableState, key = task.id) {
                            SwipeableTaskRow(
                                task = task,
                                onToggle = { onToggle(task.id) },
                                onDelete = { onDelete(task.id) },
                                onSetDueToday = { onSetDueToday(task.id) },
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
            onCreate = { data ->
                onCreate(data.title)
                showCreateSheet = false
            },
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TaskSummaryCard(
    totalCount: Int,
    completedCount: Int,
    statusFilter: String?,
    onSetFilter: (String?) -> Unit,
) {
    ClawSectionCard(tone = ClawTone.Primary, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
        Text(
            text = if (totalCount == 0) "Nothing scheduled yet" else "$completedCount of $totalCount tasks complete",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = "Swipe for quick actions, drag to reorder, and keep the current focus visible.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.82f),
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            ClawMetricPill(
                label = "Active",
                value = (totalCount - completedCount).coerceAtLeast(0).toString(),
                modifier = Modifier.weight(1f),
            )
            ClawMetricPill(
                label = "Done",
                value = completedCount.toString(),
                modifier = Modifier.weight(1f),
            )
            ClawMetricPill(
                label = "View",
                value = when (statusFilter) {
                    null -> "All"
                    "pending" -> "Open"
                    else -> "Done"
                },
                modifier = Modifier.weight(1f),
            )
        }
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            TaskFilterChip(
                label = "All",
                selected = statusFilter == null,
                onClick = { onSetFilter(null) },
            )
            TaskFilterChip(
                label = "Pending",
                selected = statusFilter == "pending",
                onClick = { onSetFilter("pending") },
            )
            TaskFilterChip(
                label = "Done",
                selected = statusFilter == "completed",
                onClick = { onSetFilter("completed") },
            )
        }
    }
}

@Composable
private fun TaskFilterChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = { Text(label) },
        colors = FilterChipDefaults.filterChipColors(
            selectedContainerColor = MaterialTheme.colorScheme.surface,
            selectedLabelColor = MaterialTheme.colorScheme.primary,
        ),
    )
}

@Composable
private fun SwipeableTaskRow(
    task: Todo,
    onToggle: () -> Unit,
    onDelete: () -> Unit,
    onSetDueToday: () -> Unit,
    onClick: () -> Unit,
    dragModifier: Modifier = Modifier,
) {
    SwipeToDismissCard(onDelete = onDelete, onSetDueToday = onSetDueToday) {
        TaskRow(task = task, onToggle = onToggle, onClick = onClick, dragModifier = dragModifier)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TaskRow(
    task: Todo,
    onToggle: () -> Unit,
    onClick: () -> Unit,
    dragModifier: Modifier = Modifier,
) {
    val isCompleted = task.status == "completed"
    val view = LocalView.current
    val completionAlpha by animateFloatAsState(
        targetValue = if (isCompleted) 0.65f else 1f,
        animationSpec = tween(durationMillis = 220),
        label = "task_alpha",
    )

    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = MaterialTheme.shapes.extraLarge,
        color = MaterialTheme.colorScheme.surfaceContainerLow,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 16.dp)
                .alpha(completionAlpha),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Icon(
                    Icons.Default.DragHandle,
                    contentDescription = "Reorder",
                    modifier = dragModifier,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
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
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = task.title,
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = FontWeight.Medium,
                            textDecoration = if (isCompleted) TextDecoration.LineThrough else null,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f, fill = false),
                        )
                        if (task.isRecurring) {
                            Icon(
                                imageVector = Icons.Default.Repeat,
                                contentDescription = "Recurring",
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(16.dp),
                            )
                        }
                    }
                    if (!task.description.isNullOrBlank()) {
                        Text(
                            text = task.description,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                PriorityChip(task.priority)
                task.dueDate?.let {
                    ClawStatusChip(
                        text = it,
                        tone = ClawTone.Warning,
                    )
                }
                inboxStateLabel(task.inboxState)?.let { label ->
                    ClawStatusChip(
                        text = label,
                        tone = if (label == "Failed") ClawTone.Error else ClawTone.Default,
                    )
                }
            }
        }
    }
}

private fun inboxStateLabel(inboxState: String?): String? = when (inboxState) {
    null, "none" -> null
    "classifying", "planning" -> "Planning"
    "plan_ready" -> "Review"
    "captured" -> "Organize"
    "error" -> "Failed"
    else -> inboxState.replaceFirstChar { it.uppercase() }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun TaskDetailView(
    task: Todo,
    onBack: () -> Unit,
    onToggle: () -> Unit,
    onDelete: () -> Unit,
) {
    Scaffold(
        topBar = {
            LargeTopAppBar(
                title = {
                    ClawTopBarTitle(
                        title = "Task detail",
                        subtitle = "Context, status, and metadata in one place.",
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { onDelete(); onBack() }) {
                        Icon(
                            Icons.Default.Delete,
                            contentDescription = "Delete",
                            tint = MaterialTheme.colorScheme.error,
                        )
                    }
                },
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item {
                ClawSectionCard(tone = ClawTone.Primary) {
                    Text(
                        text = task.title,
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(
                            checked = task.status == "completed",
                            onCheckedChange = { onToggle() },
                        )
                        Text(
                            text = if (task.status == "completed") "Completed" else "Pending",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }
            }

            if (!task.description.isNullOrBlank()) {
                item {
                    ClawSectionCard {
                        ClawSectionHeader(
                            title = "Description",
                            subtitle = "Notes and supporting detail.",
                        )
                        Text(
                            text = task.description,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }
            }

            item {
                ClawSectionCard {
                    ClawSectionHeader(
                        title = "Details",
                        subtitle = "Operational metadata for this task.",
                    )
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        PriorityChip(task.priority)
                        task.dueDate?.let {
                            ClawStatusChip(text = it, tone = ClawTone.Warning)
                        }
                        if (task.isRecurring) {
                            ClawStatusChip(text = "Recurring", tone = ClawTone.Success)
                        }
                        inboxStateLabel(task.inboxState)?.let {
                            ClawStatusChip(text = it, tone = ClawTone.Default)
                        }
                    }
                }
            }

            if (!task.tags.isNullOrEmpty()) {
                item {
                    ClawSectionCard {
                        ClawSectionHeader(
                            title = "Tags",
                            subtitle = "Labels attached to this work item.",
                        )
                        FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            task.tags.forEach { tag ->
                                ClawStatusChip(text = tag, tone = ClawTone.Default)
                            }
                        }
                    }
                }
            }
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
