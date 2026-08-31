package com.clawchat.android.feature.planner

import android.os.Build
import android.text.format.DateFormat
import android.view.HapticFeedbackConstants
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLocale
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.ui.ClawEmptyState
import com.clawchat.android.core.ui.ClawListItemSurface
import com.clawchat.android.core.ui.ClawListSection
import com.clawchat.android.core.ui.ClawNavigationMenuButton
import com.clawchat.android.core.ui.ClawSectionCard
import com.clawchat.android.core.ui.ClawSectionHeader
import com.clawchat.android.core.ui.ClawStatusChip
import com.clawchat.android.core.ui.ClawTone
import com.clawchat.android.core.ui.ClawTopBarColors
import com.clawchat.android.core.ui.SwipeToDismissCard
import com.clawchat.android.core.ui.TaskCreateSheet
import com.clawchat.android.core.ui.localizedErrorMessage
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.temporal.WeekFields

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WeekScreen(
    onOpenNavigation: () -> Unit = {},
    viewModel: WeekViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val locale = LocalLocale.current.platformLocale
    val currentWeek = remember(locale) {
        weekRange(LocalDate.now(), WeekFields.of(locale).firstDayOfWeek)
    }
    var showCreateSheet by remember { mutableStateOf(false) }

    LaunchedEffect(currentWeek) {
        viewModel.show(currentWeek)
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = stringResource(R.string.week_title),
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold,
                    )
                },
                navigationIcon = { ClawNavigationMenuButton(onClick = onOpenNavigation) },
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
                    contentDescription = stringResource(R.string.week_cd_capture_task),
                )
            }
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = state.isLoading &&
                (state.overdue.isNotEmpty() || state.tasksByDate.isNotEmpty()),
            onRefresh = viewModel::refresh,
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            WeekContent(
                state = state,
                locale = locale,
                onToggle = viewModel::toggleComplete,
                onDelete = viewModel::deleteTask,
                onSetDueToday = viewModel::setDueToday,
                onCreate = { showCreateSheet = true },
            )
        }
    }

    if (showCreateSheet) {
        TaskCreateSheet(
            onDismiss = { showCreateSheet = false },
            initialDueDate = LocalDate.now().toString(),
            onCreate = { input: TodoCreate ->
                viewModel.createTask(input)
                showCreateSheet = false
            },
        )
    }
}

@Composable
private fun WeekContent(
    state: WeekUiState,
    locale: java.util.Locale,
    onToggle: (String) -> Unit,
    onDelete: (String) -> Unit,
    onSetDueToday: (String) -> Unit,
    onCreate: () -> Unit,
) {
    val range = state.range
    val taskCount = state.overdue.size + state.tasksByDate.values.sumOf(List<Todo>::size)
    val rangeFormatter = remember(locale) {
        DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, "MMMd"), locale)
    }
    val dayFormatter = remember(locale) {
        DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, "MMMdEEE"), locale)
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 4.dp, bottom = 104.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (state.isOffline) {
            item {
                ClawStatusChip(
                    text = stringResource(R.string.week_offline_cached),
                    tone = ClawTone.Error,
                )
            }
        }

        state.error?.let { message ->
            item {
                ClawStatusChip(text = localizedErrorMessage(message), tone = ClawTone.Error)
            }
        }

        range?.let {
            item {
                ClawSectionCard {
                    Text(
                        text = "${it.start.format(rangeFormatter)} – ${it.endInclusive.format(rangeFormatter)}",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        text = pluralStringResource(R.plurals.week_active_tasks, taskCount, taskCount),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        if (state.overdue.isNotEmpty()) {
            item {
                WeekTaskSection(
                    title = stringResource(R.string.week_overdue_title),
                    subtitle = stringResource(R.string.week_overdue_subtitle),
                    tasks = state.overdue,
                    tone = ClawTone.Error,
                    onToggle = onToggle,
                    onDelete = onDelete,
                    onSetDueToday = onSetDueToday,
                )
            }
        }

        state.tasksByDate.toSortedMap().forEach { (date, tasks) ->
            item(key = date.toString()) {
                WeekTaskSection(
                    title = date.format(dayFormatter),
                    tasks = tasks,
                    onToggle = onToggle,
                    onDelete = onDelete,
                    onSetDueToday = onSetDueToday,
                )
            }
        }

        if (state.isLoading && taskCount == 0) {
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 48.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = stringResource(R.string.week_loading),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        } else if (!state.isLoading && state.error == null && taskCount == 0) {
            item {
                ClawEmptyState(
                    title = stringResource(R.string.week_empty_title),
                    description = stringResource(R.string.week_empty_description),
                    actionLabel = stringResource(R.string.week_empty_action),
                    onActionClick = onCreate,
                )
            }
        }
    }
}

@Composable
private fun WeekTaskSection(
    title: String,
    tasks: List<Todo>,
    subtitle: String? = null,
    tone: ClawTone = ClawTone.Default,
    onToggle: (String) -> Unit,
    onDelete: (String) -> Unit,
    onSetDueToday: (String) -> Unit,
) {
    ClawListSection(
        tone = tone,
        header = { ClawSectionHeader(title = title, subtitle = subtitle, count = tasks.size) },
    ) {
        Column {
            tasks.forEach { task ->
                SwipeToDismissCard(
                    onDelete = { onDelete(task.id) },
                    onSetDueToday = { onSetDueToday(task.id) },
                ) {
                    WeekTaskRow(task = task, onToggle = { onToggle(task.id) })
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WeekTaskRow(task: Todo, onToggle: () -> Unit) {
    val view = LocalView.current
    val checkboxDescription = stringResource(R.string.week_mark_complete, task.title)

    ClawListItemSurface {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Checkbox(
                checked = false,
                modifier = Modifier.semantics { contentDescription = checkboxDescription },
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
                    text = task.title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                )
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    if (task.status == TaskStatus.IN_PROGRESS) {
                        ClawStatusChip(
                            text = stringResource(R.string.week_status_in_progress),
                            tone = ClawTone.Primary,
                        )
                    }
                    ClawStatusChip(
                        text = priorityLabel(task.priority),
                        tone = priorityTone(task.priority),
                    )
                    if (task.isRecurring) {
                        ClawStatusChip(
                            text = stringResource(R.string.week_recurring),
                            tone = ClawTone.Success,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun priorityLabel(priority: String): String = when (priority.lowercase()) {
    "low" -> stringResource(R.string.week_priority_low)
    "medium" -> stringResource(R.string.week_priority_medium)
    "high" -> stringResource(R.string.week_priority_high)
    "urgent" -> stringResource(R.string.week_priority_urgent)
    else -> priority
}

private fun priorityTone(priority: String): ClawTone = when (priority.lowercase()) {
    "high", "urgent" -> ClawTone.Error
    "medium" -> ClawTone.Warning
    else -> ClawTone.Default
}
