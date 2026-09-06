package com.clawchat.android.feature.tasks

import android.os.Build
import android.view.HapticFeedbackConstants
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import com.clawchat.android.core.ui.ClawComposer
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Search
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
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalLocale
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
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

internal fun requiresVerdictConfirmation(todo: Todo, nextStatus: TaskStatus): Boolean =
    nextStatus == TaskStatus.COMPLETED &&
        todo.status != TaskStatus.COMPLETED &&
        todo.tags.orEmpty().any { it.removePrefix("#").startsWith("exp/") }

private fun taskTagLabel(tag: String): String = "#${tag.removePrefix("#")}"

@Composable
fun TasksScreen(
    allowTaskNotes: Boolean = false,
    onOpenProjects: (() -> Unit)? = null,
    onOpenSearch: () -> Unit = {},
    initialTodoId: String? = null,
    onOpenConversation: (String) -> Unit = {},
    viewModel: TasksViewModel = hiltViewModel(),
    notesViewModel: TaskNotesViewModel = hiltViewModel(),
    stepsViewModel: TaskStepsViewModel = hiltViewModel(),
) {
    LaunchedEffect(viewModel) {
        viewModel.openThreadEvents.collect(onOpenConversation)
    }
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val notesByTask by notesViewModel.notes.collectAsStateWithLifecycle()
    val noteTaskId = state.selectedTask?.id
    val stepsByTask by stepsViewModel.steps.collectAsStateWithLifecycle()
    var parentTrail by rememberSaveable { mutableStateOf(emptyList<String>()) }
    val returnFromDetail: () -> Unit = {
        val parentId = parentTrail.lastOrNull()
        parentTrail = parentTrail.dropLast(1)
        if (parentId == null) viewModel.selectTask(null) else viewModel.selectTaskById(parentId)
    }
    LaunchedEffect(noteTaskId) { noteTaskId?.let(stepsViewModel::load) }
    LaunchedEffect(state.selectedTask?.id, allowTaskNotes) {
        if (allowTaskNotes) state.selectedTask?.id?.let(notesViewModel::load)
    }
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
        returnFromDetail()
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
            onBack = returnFromDetail,
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
            onSetDueDate = { date ->
                state.selectedTask?.let { task ->
                    viewModel.updateTask(task.id, TodoUpdate(dueDate = date))
                }
            },
            onDelete = { viewModel.deleteTask(state.selectedTask!!.id) },
            onDiscuss = { viewModel.openTaskThread(state.selectedTask!!.id) },
            notes = if (allowTaskNotes) notesByTask[noteTaskId] ?: TaskNotesState() else null,
            onNoteChange = { text -> noteTaskId?.let { notesViewModel.edit(it, text) } },
            onSendNote = { noteTaskId?.let(notesViewModel::send) },
            onReloadNotes = { noteTaskId?.let(notesViewModel::load) },
            steps = stepsByTask[noteTaskId] ?: TaskStepsState(),
            onOpenStep = { step ->
                noteTaskId?.let { parentTrail = parentTrail + it }
                viewModel.selectTaskById(step.id)
            },
            onStepEdit = { text -> noteTaskId?.let { stepsViewModel.edit(it, text) } },
            onStepAdd = { state.selectedTask?.let(stepsViewModel::add) },
            onStepsReload = { noteTaskId?.let(stepsViewModel::load) },
        )
    } else {
        TaskListView(
            tasks = state.tasks,
            isLoading = state.isLoading,
            snackbarHostState = snackbarHostState,
            onOpenSearch = onOpenSearch,
            onOpenProjects = onOpenProjects,
            onSelect = { task ->
                parentTrail = emptyList()
                viewModel.selectTask(task)
            },
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TaskListView(
    onOpenProjects: (() -> Unit)?,
    tasks: List<Todo>,
    isLoading: Boolean,
    snackbarHostState: SnackbarHostState,
    onOpenSearch: () -> Unit,
    onSelect: (Todo) -> Unit,
    onToggle: (Todo) -> Unit,
    onDelete: (String) -> Unit,
    onSetDueToday: (String) -> Unit,
    onCreate: (TodoCreate) -> Unit,
) {
    var showCreateSheet by remember { mutableStateOf(false) }

    val taskCandidates = tasks.filter { task ->
        val inboxState = task.inboxState
        inboxState == null || inboxState == "none"
    }
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                navigationIcon = { com.clawchat.android.core.ui.NavigationMenuButton() },
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
        TaskStatusPage(
            modifier = Modifier.padding(padding),
            tasks = taskCandidates,
            isLoading = isLoading,
            onSelect = onSelect,
            onToggle = onToggle,
            onDelete = onDelete,
            onSetDueToday = onSetDueToday,
            onCreate = { showCreateSheet = true },
        )
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
    modifier: Modifier = Modifier,
    tasks: List<Todo>,
    isLoading: Boolean,
    onSelect: (Todo) -> Unit,
    onToggle: (Todo) -> Unit,
    onDelete: (String) -> Unit,
    onSetDueToday: (String) -> Unit,
    onCreate: () -> Unit,
) {
    if (isLoading && tasks.isEmpty()) {
        Box(
            modifier = modifier.fillMaxSize(),
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
            modifier = modifier
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
        val sections = splitTasksForUnifiedView(tasks)
        var showFinished by rememberSaveable { mutableStateOf(false) }

        LazyColumn(
            modifier = modifier.fillMaxSize(),
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
            val finishedCount = sections.completed.size + sections.cancelled.size
            if (finishedCount > 0) {
                item(key = "finished_boundary") {
                    FinishedTasksBoundary(
                        count = finishedCount,
                        expanded = showFinished,
                        onToggle = { showFinished = !showFinished },
                    )
                }
            }
            if (showFinished) {
                items(sections.completed, key = { it.id }) { task ->
                    SwipeableTaskRow(
                        task = task,
                        onToggle = { onToggle(task) },
                        onDelete = { onDelete(task.id) },
                        onSetDueToday = { onSetDueToday(task.id) },
                        onClick = { onSelect(task) },
                    )
                }
                if (sections.cancelled.isNotEmpty()) {
                    item(key = "cancelled_boundary") {
                        CancelledTasksBoundary(count = sections.cancelled.size)
                    }
                    items(sections.cancelled, key = { it.id }) { task ->
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
}

internal data class TaskListSections(
    val active: List<Todo>,
    val completed: List<Todo>,
    val cancelled: List<Todo>,
)

internal fun splitTasksForUnifiedView(tasks: List<Todo>): TaskListSections = TaskListSections(
    active = tasks.filter { it.status == TaskStatus.PENDING || it.status == TaskStatus.IN_PROGRESS },
    completed = tasks.filter { it.status == TaskStatus.COMPLETED },
    cancelled = tasks.filter { it.status == TaskStatus.CANCELLED },
)

@Composable
private fun FinishedTasksBoundary(
    count: Int,
    expanded: Boolean,
    onToggle: () -> Unit,
) {
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
        TextButton(onClick = onToggle) {
            Text(
                text = stringResource(R.string.tasks_finished_boundary, count),
                style = MaterialTheme.typography.labelMedium,
            )
            Icon(
                imageVector = if (expanded) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                contentDescription = stringResource(
                    if (expanded) R.string.tasks_hide_finished else R.string.tasks_show_finished,
                ),
            )
        }
        HorizontalDivider(
            modifier = Modifier.weight(1f),
            color = MaterialTheme.colorScheme.outlineVariant,
        )
    }
}

@Composable
private fun CancelledTasksBoundary(count: Int) {
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
            text = stringResource(R.string.tasks_cancelled_boundary, count),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        HorizontalDivider(
            modifier = Modifier.weight(1f),
            color = MaterialTheme.colorScheme.outlineVariant,
        )
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

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun TaskDetailView(
    steps: TaskStepsState,
    onOpenStep: (Todo) -> Unit,
    onStepEdit: (String) -> Unit,
    onStepAdd: () -> Unit,
    onStepsReload: () -> Unit,
    notes: TaskNotesState?,
    onNoteChange: (String) -> Unit,
    onSendNote: () -> Unit,
    onReloadNotes: () -> Unit,
    task: Todo,
    relationships: List<TaskRelationship>,
    isLoadingRelationships: Boolean,
    relationshipError: String?,
    taskTitles: Map<String, String>,
    snackbarHostState: SnackbarHostState,
    onBack: () -> Unit,
    onToggle: () -> Unit,
    onSetDueDate: (String) -> Unit,
    onDelete: () -> Unit,
    onDiscuss: () -> Unit = {},
) {
    val isCompleted = task.status == TaskStatus.COMPLETED
    var showDatePicker by rememberSaveable(task.id) { mutableStateOf(false) }
    var detailsOpen by rememberSaveable(task.id) { mutableStateOf(false) }
    val detailsState = stringResource(if (detailsOpen) R.string.tasks_details_expanded else R.string.tasks_details_collapsed)
    val checkboxDescription = stringResource(
        if (isCompleted) R.string.tasks_mark_incomplete else R.string.tasks_mark_complete,
        task.title,
    )
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        bottomBar = {
            notes?.let { note ->
                ClawComposer(
                    value = note.draft, onValueChange = onNoteChange,
                    placeholder = stringResource(R.string.tasks_note_hint),
                    enabled = !note.sending,
                    actionEnabled = !note.loading && !note.sending && note.draft.trim().length in 1..4000,
                    actionIcon = Icons.AutoMirrored.Filled.Send,
                    actionLabel = stringResource(R.string.tasks_note_send), onAction = onSendNote,
                ) {
                    Text(stringResource(if (note.sending) R.string.tasks_note_sending else R.string.tasks_note_scope),
                        style = MaterialTheme.typography.bodySmall)
                    note.sendError?.let { Text(localizedErrorMessage(it), color = MaterialTheme.colorScheme.error) }
                    if (note.draft.trim().length > 4000) Text(stringResource(R.string.tasks_note_too_long), color = MaterialTheme.colorScheme.error)
                }
            }
        },
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
                        if (task.status == TaskStatus.CANCELLED) {
                            Text(
                                text = stringResource(R.string.tasks_status_cancelled),
                                style = MaterialTheme.typography.bodyMedium,
                            )
                        }
                    }
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
                        inboxStateLabel(task.inboxState)?.let {
                            ClawStatusChip(text = it, tone = ClawTone.Default)
                        }
                    }
                    // The thread about this task: steps and delegated runs start there.
                    TextButton(onClick = onDiscuss) {
                        Text(stringResource(R.string.tasks_discuss_with_agent))
                    }
                    TextButton(
                        onClick = { detailsOpen = !detailsOpen },
                        modifier = Modifier.semantics { stateDescription = detailsState },
                    ) {
                        Icon(
                            if (detailsOpen) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                            contentDescription = null,
                        )
                        Text(stringResource(R.string.tasks_details_title))
                    }
                    if (detailsOpen) {
                        task.description?.takeIf { it.isNotBlank() }?.let { description ->
                            ClawSectionHeader(title = stringResource(R.string.tasks_description_title))
                            Text(text = description, style = MaterialTheme.typography.bodyMedium)
                        }
                        task.tags?.takeIf { it.isNotEmpty() }?.let { tags ->
                            ClawSectionHeader(title = stringResource(R.string.tasks_tags_title))
                            FlowRow(
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                tags.forEach { tag ->
                                    ClawStatusChip(text = taskTagLabel(tag), tone = ClawTone.Default)
                                }
                            }
                        }
                    }
                }
            }

            // Keep dependencies, loading and failures visible; hide only the empty placeholder.
            if (task.syncStatus != "local" &&
                (detailsOpen || relationships.isNotEmpty() || isLoadingRelationships || relationshipError != null)
            ) {
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

            item(key = "task-steps") {
                TaskStepsSection(task.id, steps, onOpenStep, onStepEdit, onStepAdd, onStepsReload)
            }
            notes?.let { note ->
                item {
                    Text(stringResource(R.string.tasks_notes_title), style = MaterialTheme.typography.titleMedium)
                    if (note.loading) Text(stringResource(R.string.tasks_notes_loading))
                    note.loadError?.let {
                        Text(localizedErrorMessage(it), color = MaterialTheme.colorScheme.error)
                        TextButton(onClick = onReloadNotes) { Text(stringResource(R.string.tasks_notes_retry)) }
                    }
                }
                items(note.comments, key = { "note:${it.id}" }) { comment ->
                    ClawSectionCard {
                        val time = remember(comment.createdAt) {
                            runCatching { java.time.OffsetDateTime.parse(comment.createdAt)
                                .atZoneSameInstant(java.time.ZoneId.systemDefault())
                                .format(java.time.format.DateTimeFormatter.ofLocalizedDateTime(java.time.format.FormatStyle.SHORT))
                            }.getOrDefault(comment.createdAt)
                        }
                        Text(time, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(comment.content, style = MaterialTheme.typography.bodyMedium)
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
