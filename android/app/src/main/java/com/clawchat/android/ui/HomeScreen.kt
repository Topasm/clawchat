package com.clawchat.android.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.clawchat.android.core.data.model.Event
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.feature.inbox.InboxViewModel
import com.clawchat.android.feature.tasks.TasksViewModel
import com.clawchat.android.feature.today.TodayViewModel

private enum class HomeTab(val label: String) {
    Today("My Day"),
    Inbox("Inbox"),
    Tasks("Tasks"),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    todayViewModel: TodayViewModel = hiltViewModel(),
    inboxViewModel: InboxViewModel = hiltViewModel(),
    tasksViewModel: TasksViewModel = hiltViewModel(),
) {
    val todayState by todayViewModel.uiState.collectAsState()
    val inboxState by inboxViewModel.uiState.collectAsState()
    val tasksState by tasksViewModel.uiState.collectAsState()

    var selectedTab by rememberSaveable { mutableStateOf(HomeTab.Today.name) }
    val currentTab = HomeTab.valueOf(selectedTab)

    // Task detail mode
    if (tasksState.selectedTask != null && currentTab == HomeTab.Tasks) {
        TaskDetailView(
            task = tasksState.selectedTask!!,
            onBack = { tasksViewModel.selectTask(null) },
            onToggle = { tasksViewModel.toggleComplete(tasksState.selectedTask!!.id) },
            onDelete = { tasksViewModel.deleteTask(tasksState.selectedTask!!.id) },
        )
        return
    }

    var inputText by rememberSaveable { mutableStateOf("") }

    val isRefreshing = when (currentTab) {
        HomeTab.Today -> todayState.isRefreshing
        HomeTab.Inbox -> inboxState.isRefreshing
        HomeTab.Tasks -> tasksState.isLoading && tasksState.tasks.isNotEmpty()
    }

    Scaffold { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            // ── Header ──────────────────────────────────────────────
            Text(
                text = todayState.greeting.ifBlank { "My Day" },
                style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.padding(start = 20.dp, top = 16.dp, end = 20.dp, bottom = 4.dp),
            )

            // ── Tab row ─────────────────────────────────────────────
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                HomeTab.entries.forEach { tab ->
                    val isSelected = currentTab == tab
                    val badge = when (tab) {
                        HomeTab.Inbox -> {
                            val count = inboxState.planningNow.size +
                                inboxState.reviewSuggestion.size +
                                inboxState.needsOrganizing.size +
                                inboxState.failed.size
                            if (count > 0) count else null
                        }
                        HomeTab.Today -> {
                            val count = todayState.overdueTodos.size
                            if (count > 0) count else null
                        }
                        else -> null
                    }

                    FilterChip(
                        selected = isSelected,
                        onClick = { selectedTab = tab.name },
                        label = {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(tab.label)
                                if (badge != null) {
                                    Spacer(Modifier.width(4.dp))
                                    Badge(
                                        containerColor = if (tab == HomeTab.Today) MaterialTheme.colorScheme.error
                                        else MaterialTheme.colorScheme.primary,
                                    ) {
                                        Text("$badge")
                                    }
                                }
                            }
                        },
                    )
                }
            }

            // ── Content area ────────────────────────────────────────
            PullToRefreshBox(
                isRefreshing = isRefreshing,
                onRefresh = {
                    when (currentTab) {
                        HomeTab.Today -> todayViewModel.refresh()
                        HomeTab.Inbox -> inboxViewModel.refresh()
                        HomeTab.Tasks -> tasksViewModel.loadTasks()
                    }
                },
                modifier = Modifier.weight(1f),
            ) {
                AnimatedContent(
                    targetState = currentTab,
                    transitionSpec = { fadeIn() togetherWith fadeOut() },
                    label = "tab_content",
                ) { tab ->
                    when (tab) {
                        HomeTab.Today -> TodayContent(
                            todayTodos = todayState.todayTodos,
                            overdueTodos = todayState.overdueTodos,
                            todayEvents = todayState.todayEvents,
                            inboxPreview = todayState.inboxPreview,
                            onToggle = todayViewModel::toggleComplete,
                            onInboxTabClick = { selectedTab = HomeTab.Inbox.name },
                        )
                        HomeTab.Inbox -> InboxContent(
                            state = inboxState,
                            onOrganize = inboxViewModel::organize,
                            onRetry = inboxViewModel::retryOrganize,
                        )
                        HomeTab.Tasks -> TasksContent(
                            tasks = tasksState.tasks,
                            statusFilter = tasksState.statusFilter,
                            onToggle = tasksViewModel::toggleComplete,
                            onSelect = tasksViewModel::selectTask,
                            onSetFilter = tasksViewModel::setStatusFilter,
                        )
                    }
                }
            }

            // ── Fixed bottom input bar ──────────────────────────────
            Surface(tonalElevation = 1.dp) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedTextField(
                        value = inputText,
                        onValueChange = { inputText = it },
                        placeholder = { Text("Add a task\u2026") },
                        modifier = Modifier.weight(1f),
                        singleLine = true,
                        shape = RoundedCornerShape(24.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant,
                        ),
                    )
                    Spacer(Modifier.width(8.dp))
                    FilledIconButton(
                        onClick = {
                            if (inputText.isNotBlank()) {
                                todayViewModel.quickAdd(inputText.trim())
                                inputText = ""
                            }
                        },
                        enabled = inputText.isNotBlank(),
                    ) {
                        Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Add")
                    }
                }
            }
        }
    }
}

// ── Today tab content ────────────────────────────────────────────────────────

@Composable
private fun TodayContent(
    todayTodos: List<Todo>,
    overdueTodos: List<Todo>,
    todayEvents: List<Event>,
    inboxPreview: List<Todo>,
    onToggle: (String) -> Unit,
    onInboxTabClick: () -> Unit,
) {
    if (todayTodos.isEmpty() && overdueTodos.isEmpty() && todayEvents.isEmpty() && inboxPreview.isEmpty()) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(
                    Icons.Default.CheckCircle,
                    contentDescription = null,
                    modifier = Modifier.size(48.dp),
                    tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.5f),
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    "All clear for today",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        return
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
    ) {
        if (overdueTodos.isNotEmpty()) {
            item { SectionHeader("Overdue", isError = true) }
            items(overdueTodos, key = { it.id }) { todo ->
                TodoRow(todo = todo, onToggle = { onToggle(todo.id) })
            }
            item { Spacer(Modifier.height(12.dp)) }
        }

        if (todayTodos.isNotEmpty()) {
            if (overdueTodos.isNotEmpty()) {
                item { SectionHeader("Today") }
            }
            items(todayTodos, key = { it.id }) { todo ->
                TodoRow(todo = todo, onToggle = { onToggle(todo.id) })
            }
            item { Spacer(Modifier.height(12.dp)) }
        }

        if (todayEvents.isNotEmpty()) {
            item { SectionHeader("Events") }
            items(todayEvents, key = { it.id }) { event ->
                EventRow(event = event)
            }
            item { Spacer(Modifier.height(12.dp)) }
        }

        if (inboxPreview.isNotEmpty()) {
            item { SectionHeader("Needs review") }
            items(inboxPreview, key = { "inbox-${it.id}" }) { todo ->
                InboxPreviewRow(todo = todo)
            }
            item {
                TextButton(
                    onClick = onInboxTabClick,
                    modifier = Modifier.padding(start = 4.dp),
                ) { Text("See all in Inbox") }
            }
        }
    }
}

// ── Inbox tab content ────────────────────────────────────────────────────────

@Composable
private fun InboxContent(
    state: com.clawchat.android.feature.inbox.InboxUiState,
    onOrganize: (String) -> Unit,
    onRetry: (String) -> Unit,
) {
    val isEmpty = state.planningNow.isEmpty() && state.reviewSuggestion.isEmpty() &&
        state.needsOrganizing.isEmpty() && state.failed.isEmpty()

    if (state.isLoading) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        return
    }

    if (isEmpty) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(
                    Icons.Default.CheckCircle,
                    contentDescription = null,
                    modifier = Modifier.size(48.dp),
                    tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.5f),
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    "Inbox is clear",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        return
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
    ) {
        if (state.planningNow.isNotEmpty()) {
            item { SectionHeader("Planning now") }
            items(state.planningNow, key = { it.id }) { todo ->
                InboxItemRow(todo = todo, showSpinner = true)
            }
            item { Spacer(Modifier.height(12.dp)) }
        }
        if (state.reviewSuggestion.isNotEmpty()) {
            item { SectionHeader("Review suggestion") }
            items(state.reviewSuggestion, key = { it.id }) { todo ->
                InboxItemRow(
                    todo = todo,
                    actionLabel = "Review",
                    onAction = { onOrganize(todo.id) },
                )
            }
            item { Spacer(Modifier.height(12.dp)) }
        }
        if (state.needsOrganizing.isNotEmpty()) {
            item { SectionHeader("Needs organizing") }
            items(state.needsOrganizing, key = { it.id }) { todo ->
                InboxItemRow(
                    todo = todo,
                    actionLabel = "Organize",
                    onAction = { onOrganize(todo.id) },
                )
            }
            item { Spacer(Modifier.height(12.dp)) }
        }
        if (state.failed.isNotEmpty()) {
            item { SectionHeader("Failed", isError = true) }
            items(state.failed, key = { it.id }) { todo ->
                InboxItemRow(
                    todo = todo,
                    actionLabel = "Retry",
                    onAction = { onRetry(todo.id) },
                    isError = true,
                )
            }
        }
    }
}

// ── Tasks tab content ────────────────────────────────────────────────────────

@Composable
private fun TasksContent(
    tasks: List<Todo>,
    statusFilter: String?,
    onToggle: (String) -> Unit,
    onSelect: (Todo) -> Unit,
    onSetFilter: (String?) -> Unit,
) {
    val filteredTasks = tasks.filter { task ->
        val s = task.inboxState
        s == null || s == "none"
    }

    Column {
        // Filter chips
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FilterChip(selected = statusFilter == null, onClick = { onSetFilter(null) }, label = { Text("All") })
            FilterChip(selected = statusFilter == "pending", onClick = { onSetFilter("pending") }, label = { Text("Pending") })
            FilterChip(selected = statusFilter == "completed", onClick = { onSetFilter("completed") }, label = { Text("Done") })
        }

        if (filteredTasks.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("No tasks", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else {
            LazyColumn(
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            ) {
                items(filteredTasks, key = { it.id }) { task ->
                    TodoRow(
                        todo = task,
                        onToggle = { onToggle(task.id) },
                        onClick = { onSelect(task) },
                        showDescription = true,
                    )
                }
            }
        }
    }
}

// ── Shared row components (MS Todo-style: clean, minimal) ────────────────────

@Composable
private fun TodoRow(
    todo: Todo,
    onToggle: () -> Unit,
    onClick: (() -> Unit)? = null,
    showDescription: Boolean = false,
) {
    val isCompleted = todo.status == "completed"

    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp)
            .clip(RoundedCornerShape(12.dp))
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        shape = RoundedCornerShape(12.dp),
    ) {
        Row(
            modifier = Modifier.padding(start = 4.dp, end = 12.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Checkbox(
                checked = isCompleted,
                onCheckedChange = { onToggle() },
                colors = CheckboxDefaults.colors(
                    checkedColor = MaterialTheme.colorScheme.primary,
                ),
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    todo.title,
                    style = MaterialTheme.typography.bodyLarge,
                    textDecoration = if (isCompleted) TextDecoration.LineThrough else null,
                    color = if (isCompleted) MaterialTheme.colorScheme.onSurfaceVariant
                    else MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                val desc = todo.description
                if (showDescription && !desc.isNullOrBlank()) {
                    Text(
                        desc,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                // Due date or priority hint
                val meta = buildList {
                    if (todo.dueDate != null) add(todo.dueDate)
                    if (todo.priority == "high" || todo.priority == "urgent") add(todo.priority)
                }
                if (meta.isNotEmpty()) {
                    Text(
                        meta.joinToString(" · "),
                        style = MaterialTheme.typography.labelSmall,
                        color = if (todo.priority == "high" || todo.priority == "urgent")
                            MaterialTheme.colorScheme.error
                        else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun EventRow(event: Event) {
    Surface(
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        shape = RoundedCornerShape(12.dp),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(event.title, style = MaterialTheme.typography.bodyLarge)
                Text(
                    event.startTime,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                event.location?.let {
                    Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
private fun InboxPreviewRow(todo: Todo) {
    val stateLabel = when (todo.inboxState) {
        "plan_ready" -> "Review"
        "captured" -> "Organize"
        else -> todo.inboxState ?: ""
    }

    Surface(
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        shape = RoundedCornerShape(12.dp),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
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
            )
        }
    }
}

@Composable
private fun InboxItemRow(
    todo: Todo,
    showSpinner: Boolean = false,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
    isError: Boolean = false,
) {
    Surface(
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        shape = RoundedCornerShape(12.dp),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (showSpinner) {
                CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(12.dp))
            }
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
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                val errMsg = todo.automationError
                if (isError && !errMsg.isNullOrBlank()) {
                    Text(
                        errMsg,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            if (actionLabel != null && onAction != null) {
                Spacer(Modifier.width(8.dp))
                if (isError) {
                    FilledTonalButton(
                        onClick = onAction,
                        contentPadding = PaddingValues(horizontal = 12.dp),
                        colors = ButtonDefaults.filledTonalButtonColors(
                            containerColor = MaterialTheme.colorScheme.errorContainer,
                            contentColor = MaterialTheme.colorScheme.onErrorContainer,
                        ),
                    ) {
                        Icon(Icons.Default.Refresh, null, Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text(actionLabel)
                    }
                } else {
                    FilledTonalButton(
                        onClick = onAction,
                        contentPadding = PaddingValues(horizontal = 12.dp),
                    ) { Text(actionLabel) }
                }
            }
        }
    }
}

@Composable
private fun SectionHeader(title: String, isError: Boolean = false) {
    Text(
        title,
        style = MaterialTheme.typography.titleSmall,
        color = if (isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(start = 4.dp, top = 4.dp, bottom = 4.dp),
    )
}

// ── Task detail (kept from TasksScreen) ──────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TaskDetailView(
    task: Todo,
    onBack: () -> Unit,
    onToggle: () -> Unit,
    onDelete: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Task") },
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
            Text(task.title, style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.height(8.dp))

            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = task.status == "completed", onCheckedChange = { onToggle() })
                Text(if (task.status == "completed") "Completed" else "Pending")
            }

            Spacer(Modifier.height(16.dp))

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
