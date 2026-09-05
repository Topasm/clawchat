package com.clawchat.android.feature.tasks

import android.os.Build
import android.view.HapticFeedbackConstants
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.selection.selectable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalLocale
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.clawchat.android.core.R as CoreR
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.TaskRelationship
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.data.model.TodoUpdate
import com.clawchat.android.core.ui.ClawEmptyState
import com.clawchat.android.core.ui.ClawListItemSurface
import com.clawchat.android.core.ui.ClawSectionCard
import com.clawchat.android.core.ui.ClawSectionHeader
import com.clawchat.android.core.ui.ClawStatusChip
import com.clawchat.android.core.ui.ClawTone
import com.clawchat.android.core.ui.ClawTopBarColors
import com.clawchat.android.core.ui.SwipeToDismissCard
import com.clawchat.android.core.ui.TaskCreateSheet
import com.clawchat.android.core.ui.datePickerDate
import com.clawchat.android.core.ui.localizedErrorMessage
import com.clawchat.android.core.ui.toDatePickerMillis
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

internal val TASK_STATUS_FILTER_ORDER: List<TaskStatus?> = listOf(
    TaskStatus.IN_PROGRESS,
    TaskStatus.PENDING,
    TaskStatus.COMPLETED,
    TaskStatus.CANCELLED,
    null,
)

internal fun requiresVerdictConfirmation(todo: Todo, nextStatus: TaskStatus): Boolean =
    nextStatus == TaskStatus.COMPLETED &&
        todo.status != TaskStatus.COMPLETED &&
        todo.tags.orEmpty().any { it.removePrefix("#").startsWith("exp/") }

private fun taskTagLabel(tag: String): String = "#${tag.removePrefix("#")}"

@Composable
fun TasksScreen(
    onOpenProjects: (() -> Unit)? = null,
    onOpenSearch: () -> Unit = {},
    onOpenSettings: () -> Unit = {},
    initialTodoId: String? = null,
    onOpenConversation: (String) -> Unit = {},
    viewModel: TasksViewModel = hiltViewModel(),
) {
    LaunchedEffect(viewModel) {
        viewModel.openThreadEvents.collect(onOpenConversation)
    }
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var initialSelectionConsumed by rememberSaveable(initialTodoId) { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }
    val deletedMessage = stringResource(R.string.tasks_deleted)
    val undoLabel = stringResource(R.string.tasks_undo)
    var pendingExperimentCompletionId by remember { mutableStateOf<String?>(null) }
    val requestStatusChange: (Todo, TaskStatus) -> Unit = { task, status ->
        if (requiresVerdictConfirmation(task, status)) {
            pendingExperimentCompletionId = task.id
        } else {
            viewModel.setTaskStatus(task.id, status)
        }
    }

    BackHandler(enabled = state.selectedTask != null) {
        viewModel.selectTask(null)
    }

    LaunchedEffect(initialTodoId) {
        if (initialSelectionConsumed || initialTodoId == null) return@LaunchedEffect
        initialSelectionConsumed = true
        viewModel.selectTaskById(initialTodoId)
    }

    LaunchedEffect(state.pendingDeletion?.token) {
        val pending = state.pendingDeletion ?: return@LaunchedEffect
        val result = snackbarHostState.showSnackbar(
            message = deletedMessage,
            actionLabel = undoLabel,
            withDismissAction = true,
            duration = SnackbarDuration.Long,
        )
        if (result == SnackbarResult.ActionPerformed) {
            viewModel.undoDelete(pending.token)
        }
    }

    if (state.selectedTask != null) {
        TaskDetailView(
            task = state.selectedTask!!,
            relationships = state.relationships,
            isLoadingRelationships = state.isLoadingRelationships,
            relationshipError = state.relationshipError,
            taskTitles = state.tasks.associate { it.id to it.title } + state.relationshipTaskTitles,
            snackbarHostState = snackbarHostState,
            onBack = { viewModel.selectTask(null) },
            onToggle = {
                state.selectedTask?.let { task ->
                    val status = if (task.status == TaskStatus.COMPLETED) {
                        TaskStatus.PENDING
                    } else {
                        TaskStatus.COMPLETED
                    }
                    requestStatusChange(task, status)
                }
            },
            onSetStatus = { status ->
                state.selectedTask?.let { task ->
                    requestStatusChange(task, status)
                }
            },
            onSetDueDate = { date ->
                state.selectedTask?.let { task ->
                    viewModel.updateTask(task.id, TodoUpdate(dueDate = date))
                }
            },
            onDelete = { viewModel.deleteTask(state.selectedTask!!.id) },
            onDiscuss = { viewModel.openTaskThread(state.selectedTask!!.id) },
        )
    } else {
        TaskListView(
            tasks = state.tasks,
            isLoading = state.isLoading,
            statusFilter = state.statusFilter,
            snackbarHostState = snackbarHostState,
            onOpenSearch = onOpenSearch,
            onOpenProjects = onOpenProjects,
            onOpenSettings = onOpenSettings,
            onSelect = viewModel::selectTask,
            onToggle = { task ->
                val status = if (task.status == TaskStatus.COMPLETED) {
                    TaskStatus.PENDING
                } else {
                    TaskStatus.COMPLETED
                }
                requestStatusChange(task, status)
            },
            onDelete = viewModel::deleteTask,
            onSetDueToday = viewModel::setDueToday,
            onSetFilter = viewModel::setStatusFilter,
            onCreate = viewModel::createTask,
        )
    }

    pendingExperimentCompletionId?.let { todoId ->
        AlertDialog(
            onDismissRequest = { pendingExperimentCompletionId = null },
            title = { Text(stringResource(R.string.tasks_experiment_completion_title)) },
            text = { Text(stringResource(R.string.tasks_experiment_completion_question)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        pendingExperimentCompletionId = null
                        viewModel.completeExperiment(todoId, verdictRecorded = true)
                    },
                ) {
                    Text(stringResource(R.string.tasks_experiment_verdict_recorded))
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        pendingExperimentCompletionId = null
                        viewModel.completeExperiment(todoId, verdictRecorded = false)
                    },
                ) {
                    Text(stringResource(R.string.tasks_experiment_verdict_later))
                }
            },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
private fun TaskListView(
    onOpenProjects: (() -> Unit)?,
    tasks: List<Todo>,
    isLoading: Boolean,
    statusFilter: TaskStatus?,
    snackbarHostState: SnackbarHostState,
    onOpenSearch: () -> Unit,
    onOpenSettings: () -> Unit,
    onSelect: (Todo) -> Unit,
    onToggle: (Todo) -> Unit,
    onDelete: (String) -> Unit,
    onSetDueToday: (String) -> Unit,
    onSetFilter: (TaskStatus?) -> Unit,
    onCreate: (TodoCreate) -> Unit,
) {
    var showCreateSheet by remember { mutableStateOf(false) }

    val taskCandidates = tasks.filter { task ->
        val inboxState = task.inboxState
        inboxState == null || inboxState == "none"
    }
    val completedCount = taskCandidates.count { it.status == TaskStatus.COMPLETED }
    val activeCount = taskCandidates.count {
        it.status == TaskStatus.PENDING || it.status == TaskStatus.IN_PROGRESS
    }
    val initialPage = TASK_STATUS_FILTER_ORDER.indexOf(statusFilter).coerceAtLeast(0)
    val pagerState = rememberPagerState(
        initialPage = initialPage,
        pageCount = { TASK_STATUS_FILTER_ORDER.size },
    )
    val pagerScope = rememberCoroutineScope()

    LaunchedEffect(pagerState) {
        snapshotFlow { pagerState.settledPage }
            .distinctUntilChanged()
            .collect { page -> onSetFilter(TASK_STATUS_FILTER_ORDER[page]) }
    }

    LaunchedEffect(statusFilter) {
        val targetPage = TASK_STATUS_FILTER_ORDER.indexOf(statusFilter).coerceAtLeast(0)
        if (!pagerState.isScrollInProgress && pagerState.settledPage != targetPage) {
            pagerState.scrollToPage(targetPage)
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = stringResource(R.string.tasks_title),
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold,
                    )
                },
                actions = {
                    onOpenProjects?.let { open ->
                        TextButton(onClick = open) { Text(stringResource(R.string.projects_title)) }
                    }
                    IconButton(onClick = onOpenSearch) {
                        Icon(
                            Icons.Default.Search,
                            contentDescription = stringResource(R.string.tasks_cd_search),
                        )
                    }
                    IconButton(onClick = onOpenSettings) {
                        Icon(
                            Icons.Default.Settings,
                            contentDescription = stringResource(R.string.tasks_cd_settings),
                        )
                    }
                },
                colors = ClawTopBarColors(),
            )
        },
        floatingActionButton = {
            SmallFloatingActionButton(
                modifier = Modifier.size(48.dp),
                onClick = { showCreateSheet = true },
                shape = MaterialTheme.shapes.medium,
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ) {
                Icon(
                    Icons.Default.Add,
                    contentDescription = stringResource(R.string.tasks_cd_new_task),
                )
            }
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            TaskSummaryCard(
                totalCount = taskCandidates.size,
                activeCount = activeCount,
                completedCount = completedCount,
                statusFilter = TASK_STATUS_FILTER_ORDER[pagerState.currentPage],
                onSetFilter = { filter ->
                    val targetPage = TASK_STATUS_FILTER_ORDER.indexOf(filter)
                    if (targetPage >= 0 && targetPage != pagerState.currentPage) {
                        pagerScope.launch { pagerState.animateScrollToPage(targetPage) }
                    }
                },
            )

            HorizontalPager(
                state = pagerState,
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                key = { page -> TASK_STATUS_FILTER_ORDER[page]?.wireValue ?: "all" },
            ) { page ->
                val pageFilter = TASK_STATUS_FILTER_ORDER[page]
                val pageTasks = if (pageFilter == null) {
                    taskCandidates
                } else {
                    taskCandidates.filter { it.status == pageFilter }
                }
                TaskStatusPage(
                    tasks = pageTasks,
                    isLoading = isLoading,
                    onSelect = onSelect,
                    onToggle = onToggle,
                    onDelete = onDelete,
                    onSetDueToday = onSetDueToday,
                    onCreate = { showCreateSheet = true },
                    separateCompleted = pageFilter == null,
                )
            }
        }
    }

    if (showCreateSheet) {
        TaskCreateSheet(
            onDismiss = { showCreateSheet = false },
            onCreate = { data ->
                onCreate(data)
                showCreateSheet = false
            },
        )
    }
}

@Composable
private fun TaskStatusPage(
    tasks: List<Todo>,
    isLoading: Boolean,
    onSelect: (Todo) -> Unit,
    onToggle: (Todo) -> Unit,
    onDelete: (String) -> Unit,
    onSetDueToday: (String) -> Unit,
    onCreate: () -> Unit,
    separateCompleted: Boolean,
) {
    if (isLoading && tasks.isEmpty()) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = stringResource(R.string.tasks_loading),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    } else if (tasks.isEmpty()) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 12.dp),
            contentAlignment = Alignment.Center,
        ) {
            ClawEmptyState(
                title = stringResource(R.string.tasks_empty_title),
                description = stringResource(R.string.tasks_empty_description),
                actionLabel = stringResource(R.string.tasks_create_task),
                onActionClick = onCreate,
            )
        }
    } else {
        val lazyListState = rememberLazyListState()
        val sections = splitTasksForAllView(tasks, separateCompleted)

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            state = lazyListState,
            contentPadding = PaddingValues(
                start = 12.dp,
                end = 12.dp,
                top = 0.dp,
                bottom = 88.dp,
            ),
            verticalArrangement = Arrangement.Top,
        ) {
            items(sections.active, key = { it.id }) { task ->
                SwipeableTaskRow(
                    task = task,
                    onToggle = { onToggle(task) },
                    onDelete = { onDelete(task.id) },
                    onSetDueToday = { onSetDueToday(task.id) },
                    onClick = { onSelect(task) },
                )
            }
            if (sections.completed.isNotEmpty()) {
                item(key = "completed_boundary") {
                    CompletedTasksBoundary(count = sections.completed.size)
                }
                items(sections.completed, key = { it.id }) { task ->
                    SwipeableTaskRow(
                        task = task,
                        onToggle = { onToggle(task) },
                        onDelete = { onDelete(task.id) },
                        onSetDueToday = { onSetDueToday(task.id) },
                        onClick = { onSelect(task) },
                    )
                }
            }
        }
    }
}

internal data class TaskListSections(
    val active: List<Todo>,
    val completed: List<Todo>,
)

internal fun splitTasksForAllView(
    tasks: List<Todo>,
    separateCompleted: Boolean,
): TaskListSections = if (separateCompleted) {
    TaskListSections(
        active = tasks.filterNot { it.status == TaskStatus.COMPLETED },
        completed = tasks.filter { it.status == TaskStatus.COMPLETED },
    )
} else {
    TaskListSections(active = tasks, completed = emptyList())
}

@Composable
private fun CompletedTasksBoundary(count: Int) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 16.dp, bottom = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        HorizontalDivider(
            modifier = Modifier.weight(1f),
            color = MaterialTheme.colorScheme.outlineVariant,
        )
        Text(
            text = stringResource(R.string.tasks_completed_boundary, count),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        HorizontalDivider(
            modifier = Modifier.weight(1f),
            color = MaterialTheme.colorScheme.outlineVariant,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TaskSummaryCard(
    totalCount: Int,
    activeCount: Int,
    completedCount: Int,
    statusFilter: TaskStatus?,
    onSetFilter: (TaskStatus?) -> Unit,
) {
    val selectedFilterIndex = TASK_STATUS_FILTER_ORDER.indexOf(statusFilter).coerceAtLeast(0)
    val filterListState = rememberLazyListState()

    LaunchedEffect(selectedFilterIndex) {
        filterListState.animateScrollToItem(selectedFilterIndex)
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(0.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = if (totalCount == 0) {
                    stringResource(R.string.tasks_none_yet)
                } else {
                    stringResource(
                        R.string.tasks_summary_format,
                        pluralStringResource(
                            R.plurals.tasks_summary_active,
                            activeCount,
                            activeCount,
                        ),
                        pluralStringResource(
                            R.plurals.tasks_summary_completed,
                            completedCount,
                            completedCount,
                        ),
                        pluralStringResource(
                            R.plurals.tasks_summary_total,
                            totalCount,
                            totalCount,
                        ),
                    )
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
            Text(
                text = when (statusFilter) {
                    null -> stringResource(R.string.tasks_filter_all)
                    else -> taskStatusLabel(statusFilter)
                },
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary,
            )
        }
        LazyRow(
            modifier = Modifier.fillMaxWidth(),
            state = filterListState,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            itemsIndexed(
                items = TASK_STATUS_FILTER_ORDER,
                key = { _, status -> status?.wireValue ?: "all" },
            ) { _, status ->
                TaskFilterChip(
                    label = if (status == null) {
                        stringResource(R.string.tasks_filter_all)
                    } else {
                        taskStatusLabel(status)
                    },
                    selected = statusFilter == status,
                    onClick = { onSetFilter(status) },
                )
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.7f))
    }
}

@Composable
private fun TaskFilterChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Box(
        modifier = Modifier
            .heightIn(min = 48.dp)
            .selectable(
                selected = selected,
                onClick = onClick,
                role = Role.Tab,
            )
            .padding(horizontal = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelLarge,
            color = if (selected) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
        )
        if (selected) {
            HorizontalDivider(
                modifier = Modifier
                    .fillMaxWidth()
                    .align(Alignment.BottomCenter),
                thickness = 2.dp,
                color = MaterialTheme.colorScheme.primary,
            )
        }
    }
}

@Composable
private fun SwipeableTaskRow(
    task: Todo,
    onToggle: () -> Unit,
    onDelete: () -> Unit,
    onSetDueToday: () -> Unit,
    onClick: () -> Unit,
) {
    SwipeToDismissCard(onDelete = onDelete, onSetDueToday = onSetDueToday) {
        TaskRow(task = task, onToggle = onToggle, onClick = onClick)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TaskRow(
    task: Todo,
    onToggle: () -> Unit,
    onClick: () -> Unit,
) {
    val isCompleted = task.status == TaskStatus.COMPLETED
    val view = LocalView.current
    val checkboxDescription = stringResource(
        if (isCompleted) R.string.tasks_mark_incomplete else R.string.tasks_mark_complete,
        task.title,
    )
    val completionAlpha by animateFloatAsState(
        targetValue = if (isCompleted) 0.65f else 1f,
        animationSpec = tween(durationMillis = 220),
        label = "task_alpha",
    )

    ClawListItemSurface(onClick = onClick) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .alpha(completionAlpha),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.Top,
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
                    }
                    val description = task.description
                    if (!description.isNullOrBlank()) {
                        Text(
                            text = description,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                ClawStatusChip(
                    text = taskStatusLabel(task.status),
                    tone = taskStatusTone(task.status),
                )
                task.tags.orEmpty().filter(String::isNotBlank).forEach { tag ->
                    ClawStatusChip(
                        text = taskTagLabel(tag),
                        tone = ClawTone.Default,
                    )
                }
                task.dueDate?.let {
                    ClawStatusChip(
                        text = localizedDateLabel(it),
                        tone = ClawTone.Warning,
                    )
                }
                inboxStateLabel(task.inboxState)?.let { label ->
                    ClawStatusChip(
                        text = label,
                        tone = if (task.inboxState == "error") ClawTone.Error else ClawTone.Default,
                    )
                }
            }
        }
    }
}

@Composable
private fun inboxStateLabel(inboxState: String?): String? = when (inboxState) {
    null, "none" -> null
    "classifying", "planning" -> stringResource(R.string.tasks_inbox_planning)
    "plan_ready" -> stringResource(R.string.tasks_inbox_review)
    "captured" -> stringResource(R.string.tasks_inbox_organize)
    "error" -> stringResource(R.string.tasks_inbox_failed)
    else -> inboxState.replace('_', ' ')
}

@Composable
private fun taskStatusLabel(status: TaskStatus): String = when (status) {
    TaskStatus.PENDING -> stringResource(R.string.tasks_status_pending)
    TaskStatus.IN_PROGRESS -> stringResource(R.string.tasks_status_in_progress)
    TaskStatus.COMPLETED -> stringResource(R.string.tasks_status_completed)
    TaskStatus.CANCELLED -> stringResource(R.string.tasks_status_cancelled)
}

private fun taskStatusTone(status: TaskStatus): ClawTone = when (status) {
    TaskStatus.PENDING -> ClawTone.Default
    TaskStatus.IN_PROGRESS -> ClawTone.Primary
    TaskStatus.COMPLETED -> ClawTone.Success
    TaskStatus.CANCELLED -> ClawTone.Default
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun TaskDetailView(
    task: Todo,
    relationships: List<TaskRelationship>,
    isLoadingRelationships: Boolean,
    relationshipError: String?,
    taskTitles: Map<String, String>,
    snackbarHostState: SnackbarHostState,
    onBack: () -> Unit,
    onToggle: () -> Unit,
    onSetStatus: (TaskStatus) -> Unit,
    onSetDueDate: (String) -> Unit,
    onDelete: () -> Unit,
    onDiscuss: () -> Unit = {},
) {
    val isCompleted = task.status == TaskStatus.COMPLETED
    var showDatePicker by remember { mutableStateOf(false) }
    val checkboxDescription = stringResource(
        if (isCompleted) R.string.tasks_mark_incomplete else R.string.tasks_mark_complete,
        task.title,
    )
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = stringResource(R.string.tasks_detail_title),
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold,
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.tasks_cd_back),
                        )
                    }
                },
                actions = {
                    IconButton(onClick = onDelete) {
                        Icon(
                            Icons.Default.Delete,
                            contentDescription = stringResource(R.string.tasks_cd_delete),
                            tint = MaterialTheme.colorScheme.error,
                        )
                    }
                },
                colors = ClawTopBarColors(),
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item {
                ClawSectionCard {
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
                            checked = isCompleted,
                            modifier = Modifier.semantics {
                                contentDescription = checkboxDescription
                            },
                            onCheckedChange = { onToggle() },
                        )
                        Text(
                            text = taskStatusLabel(task.status),
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        TaskStatus.entries.forEach { status ->
                            TaskFilterChip(
                                label = taskStatusLabel(status),
                                selected = task.status == status,
                                onClick = { onSetStatus(status) },
                            )
                        }
                    }
                }
            }

            val description = task.description
            if (!description.isNullOrBlank()) {
                item {
                    ClawSectionCard {
                        ClawSectionHeader(
                            title = stringResource(R.string.tasks_description_title),
                            subtitle = stringResource(R.string.tasks_description_subtitle),
                        )
                        Text(
                            text = description,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }
            }

            item {
                ClawSectionCard {
                    ClawSectionHeader(
                        title = stringResource(R.string.tasks_details_title),
                        subtitle = stringResource(R.string.tasks_details_subtitle),
                    )
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        task.dueDate?.let {
                            InputChip(
                                selected = true,
                                onClick = { showDatePicker = true },
                                label = { Text(localizedDateLabel(it)) },
                            )
                        } ?: TextButton(onClick = { showDatePicker = true }) {
                            Text(stringResource(CoreR.string.task_add_due_date))
                        }
                        if (task.isRecurring) {
                            ClawStatusChip(
                                text = stringResource(R.string.tasks_recurring),
                                tone = ClawTone.Success,
                            )
                        }
                        inboxStateLabel(task.inboxState)?.let {
                            ClawStatusChip(text = it, tone = ClawTone.Default)
                        }
                    }
                    // The thread about this task: steps and delegated runs start there.
                    TextButton(onClick = onDiscuss) {
                        Text(stringResource(R.string.tasks_discuss_with_agent))
                    }
                }
            }

            if (task.syncStatus != "local") {
                item {
                    ClawSectionCard {
                        ClawSectionHeader(
                            title = stringResource(R.string.tasks_links_title),
                            subtitle = stringResource(R.string.tasks_links_subtitle),
                            count = relationships.size.takeIf { it > 0 },
                        )
                        when {
                            isLoadingRelationships -> Text(
                                text = stringResource(R.string.tasks_links_loading),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            relationshipError != null -> Text(
                                text = localizedErrorMessage(relationshipError),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.error,
                            )
                            relationships.isEmpty() -> Text(
                                text = stringResource(R.string.tasks_links_empty),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            else -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                relationships.forEach { relationship ->
                                    TaskRelationshipRow(
                                        relationship = relationship,
                                        currentTaskId = task.id,
                                        taskTitles = taskTitles,
                                    )
                                }
                            }
                        }
                    }
                }
            }

            val tags = task.tags
            if (!tags.isNullOrEmpty()) {
                item {
                    ClawSectionCard {
                        ClawSectionHeader(
                            title = stringResource(R.string.tasks_tags_title),
                            subtitle = stringResource(R.string.tasks_tags_subtitle),
                        )
                        FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            tags.forEach { tag ->
                                ClawStatusChip(
                                    text = taskTagLabel(tag),
                                    tone = ClawTone.Default,
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    if (showDatePicker) {
        val datePickerState = rememberDatePickerState(
            initialSelectedDateMillis = task.dueDate
                ?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
                ?.toDatePickerMillis(),
        )
        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                TextButton(onClick = {
                    datePickerState.selectedDateMillis?.let { millis ->
                        onSetDueDate(datePickerDate(millis).toString())
                    }
                    showDatePicker = false
                }) { Text(stringResource(CoreR.string.common_ok)) }
            },
            dismissButton = {
                TextButton(onClick = { showDatePicker = false }) {
                    Text(stringResource(CoreR.string.common_cancel))
                }
            },
        ) {
            DatePicker(state = datePickerState)
        }
    }
}

@Composable
private fun TaskRelationshipRow(
    relationship: TaskRelationship,
    currentTaskId: String,
    taskTitles: Map<String, String>,
) {
    val isOutgoing = relationship.sourceTaskId == currentTaskId
    val otherTaskId = if (isOutgoing) relationship.targetTaskId else relationship.sourceTaskId
    val otherTaskTitle = taskTitles[otherTaskId]
        ?: stringResource(R.string.tasks_fallback_title, otherTaskId.take(8))
    val direction = when (relationship.type) {
        "depends_on" -> if (isOutgoing) {
            stringResource(R.string.tasks_relationship_depends_on)
        } else {
            stringResource(R.string.tasks_relationship_required_by)
        }
        "duplicate" -> if (isOutgoing) {
            stringResource(R.string.tasks_relationship_duplicates)
        } else {
            stringResource(R.string.tasks_relationship_duplicated_by)
        }
        "related" -> stringResource(R.string.tasks_relationship_related_to)
        else -> relationship.type.replace('_', ' ')
    }

    ClawListItemSurface {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Text(
                    text = direction,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    text = otherTaskTitle,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                relationship.label?.takeIf { it.isNotBlank() }?.let { label ->
                    Text(
                        text = label,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            ClawStatusChip(
                text = relationshipTypeLabel(relationship.type),
                tone = if (relationship.type == "depends_on") ClawTone.Warning else ClawTone.Default,
            )
        }
    }
}

@Composable
private fun relationshipTypeLabel(type: String): String = when (type) {
    "depends_on" -> stringResource(R.string.tasks_relationship_type_depends_on)
    "duplicate" -> stringResource(R.string.tasks_relationship_type_duplicate)
    "related" -> stringResource(R.string.tasks_relationship_type_related)
    else -> type.replace('_', ' ')
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
