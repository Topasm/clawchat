package com.clawchat.android.feature.today

import android.os.Build
import android.view.HapticFeedbackConstants
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.stateDescription
import com.clawchat.android.core.ui.ClawExpand
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
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import com.clawchat.android.core.data.model.Event
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.ui.ClawFab
import com.clawchat.android.core.ui.ClawIconTile
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
import com.clawchat.android.core.ui.localizedErrorMessage
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.runtime.LaunchedEffect

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TodayScreen(
    viewModel: TodayViewModel = hiltViewModel(),
    showAgentFeatures: Boolean = true,
    onNavigateToReview: () -> Unit = {},
    onNavigateToRuns: () -> Unit = {},
    onNavigateToSearch: () -> Unit = {},
    onOpenTask: (String) -> Unit = {},
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var showQuickAdd by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }

    val deletedMessage = stringResource(R.string.today_deleted)
    val undoLabel = stringResource(R.string.today_undo)
    LaunchedEffect(state.pendingDeletion?.token) {
        val pending = state.pendingDeletion ?: return@LaunchedEffect
        val result = snackbarHostState.showSnackbar(
            message = deletedMessage,
            actionLabel = undoLabel,
            withDismissAction = true,
            duration = SnackbarDuration.Long,
        )
        if (result == SnackbarResult.ActionPerformed) viewModel.undoDelete(pending.token)
    }

    TodayContent(
        state = state,
        showAgentFeatures = showAgentFeatures,
        snackbarHostState = snackbarHostState,
        onNavigateToReview = onNavigateToReview,
        onNavigateToRuns = onNavigateToRuns,
        onNavigateToSearch = onNavigateToSearch,
        onOpenTask = onOpenTask,
        onRefresh = viewModel::refresh,
        onToggle = viewModel::toggleComplete,
        onDelete = viewModel::deleteTask,
        onSetDueToday = viewModel::setDueToday,
        onQuickAdd = { showQuickAdd = true },
    )

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

/**
 * Today's screen for a given state; [TodayScreen] wires it to the ViewModel.
 * Three blocks (overdue, today, events) under one folded line for agent work.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun TodayContent(
    state: TodayUiState,
    showAgentFeatures: Boolean,
    snackbarHostState: SnackbarHostState,
    onNavigateToReview: () -> Unit,
    onNavigateToRuns: () -> Unit,
    onNavigateToSearch: () -> Unit,
    onOpenTask: (String) -> Unit,
    onRefresh: () -> Unit,
    onToggle: (String) -> Unit,
    onDelete: (String) -> Unit,
    onSetDueToday: (String) -> Unit,
    onQuickAdd: () -> Unit,
    agentLineOpen: Boolean = false,
) {
    val hasContent = state.overdueTodos.isNotEmpty() ||
        state.todayTodos.isNotEmpty() ||
        state.todayEvents.isNotEmpty()

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbarHostState) },
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
                },
                colors = ClawTopBarColors(),
            )
        },
        floatingActionButton = {
            ClawFab(
                onClick = { onQuickAdd() },
                contentDescription = stringResource(R.string.today_cd_capture_task),
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = state.isRefreshing,
            onRefresh = onRefresh,
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
                state.error?.let { error ->
                    item {
                        ClawStatusChip(text = localizedErrorMessage(error), tone = ClawTone.Error)
                    }
                }

                if (showAgentFeatures) {
                    item {
                        AgentLine(
                            reviewCount = state.reviewCount,
                            runCount = state.runCount,
                            briefing = state.briefing,
                            initiallyOpen = agentLineOpen,
                            onNavigateToReview = onNavigateToReview,
                            onNavigateToRuns = onNavigateToRuns,
                        )
                    }
                }

                if (state.overdueTodos.isNotEmpty()) {
                    item {
                        TodoSectionCard(
                            title = stringResource(R.string.today_overdue_title),
                            todos = state.overdueTodos,
                            tone = ClawTone.Error,
                            onToggle = onToggle,
                            onDelete = onDelete,
                            onSetDueToday = onSetDueToday,
                            onOpen = onOpenTask,
                        )
                    }
                }

                if (state.todayTodos.isNotEmpty()) {
                    item {
                        TodoSectionCard(
                            title = stringResource(R.string.today_focus_title),
                            todos = state.todayTodos,
                            tone = ClawTone.Primary,
                            onToggle = onToggle,
                            onDelete = onDelete,
                            onSetDueToday = onSetDueToday,
                            onOpen = onOpenTask,
                        )
                    }
                }

                if (state.todayEvents.isNotEmpty()) {
                    item {
                        EventSectionCard(events = state.todayEvents)
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
                            onActionClick = { onQuickAdd() },
                        )
                    }
                }
            }
        }
    }
}

/**
 * Agent work and the briefing as one line, "검토 2 · 실행 1". Tapping it opens
 * the briefing and the ways into the review queue and the runs.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AgentLine(
    reviewCount: Int,
    runCount: Int,
    briefing: BriefingResponse?,
    initiallyOpen: Boolean,
    onNavigateToReview: () -> Unit,
    onNavigateToRuns: () -> Unit,
) {
    var open by rememberSaveable { mutableStateOf(initiallyOpen) }
    val openState = stringResource(if (open) R.string.today_agent_line_open else R.string.today_agent_line_closed)
    Column(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp)
                .clip(MaterialTheme.shapes.small)
                .clickable { open = !open }
                .semantics { stateDescription = openState }
                .padding(horizontal = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                stringResource(R.string.today_agent_line, reviewCount, runCount),
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Icon(
                if (open) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        ClawExpand(visible = open) {
            Column(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                briefing?.let { BriefingLines(it) }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = onNavigateToReview) { Text(stringResource(R.string.today_review_queue)) }
                    TextButton(onClick = onNavigateToRuns) { Text(stringResource(R.string.today_agent_runs)) }
                }
            }
        }
    }
}

/** The day's briefing, in plain lines under the agent line. */
@Composable
private fun BriefingLines(briefing: BriefingResponse) {
    val summary = briefing.summary.ifBlank { briefing.loadMessage }
    if (summary.isNotBlank()) {
        Text(summary, style = MaterialTheme.typography.bodyMedium)
    }
    if (briefing.loadAssessment.isNotBlank()) {
        ClawStatusChip(
            text = loadAssessmentLabel(briefing.loadAssessment),
            tone = loadTone(briefing.loadAssessment),
        )
    }
    briefing.highlights.take(3).forEach { highlight ->
        Text(
            "· $highlight",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    briefing.suggestions.forEach { suggestion ->
        Text(
            stringResource(R.string.today_suggestion_line, suggestionActionLabel(suggestion.action), suggestion.title),
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun TodoSectionCard(
    title: String,
    todos: List<Todo>,
    tone: ClawTone,
    onToggle: (String) -> Unit,
    onDelete: (String) -> Unit,
    onSetDueToday: (String) -> Unit,
    onOpen: (String) -> Unit,
) {
    ClawListSection(
        tone = tone,
        header = {
            ClawSectionHeader(
                title = title,
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
                    onOpen = { onOpen(todo.id) },
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
    onOpen: () -> Unit,
) {
    SwipeToDismissCard(onDelete = onDelete, onSetDueToday = onSetDueToday) {
        TodoRow(todo = todo, onToggle = onToggle, onOpen = onOpen)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TodoRow(
    todo: Todo,
    onToggle: () -> Unit,
    onOpen: () -> Unit,
) {
    val isCompleted = todo.status == TaskStatus.COMPLETED
    val view = LocalView.current
    val checkboxDescription = stringResource(
        if (isCompleted) R.string.today_task_mark_incomplete else R.string.today_task_mark_complete,
        todo.title,
    )

    ClawListItemSurface(onClick = onOpen) {
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
                    if (todo.status == TaskStatus.CANCELLED) {
                        ClawStatusChip(
                            text = stringResource(R.string.today_status_cancelled),
                            tone = ClawTone.Default,
                        )
                    }
                    todo.dueDate?.let {
                        ClawStatusChip(
                            text = localizedDateLabel(it),
                            tone = if (todo.status == TaskStatus.COMPLETED) ClawTone.Default else ClawTone.Warning,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun EventSectionCard(events: List<Event>) {
    ClawListSection(
        header = {
            ClawSectionHeader(
                title = stringResource(R.string.today_calendar_title),
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
            ClawIconTile(icon = ClawIcons.Today)
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
