package com.clawchat.android.feature.calendar

import android.text.format.DateFormat
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalLocale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.clawchat.android.core.data.model.Event
import com.clawchat.android.core.ui.ClawEmptyState
import com.clawchat.android.core.ui.ClawListItemSurface
import com.clawchat.android.core.ui.ClawSectionCard
import com.clawchat.android.core.ui.ClawStatusChip
import com.clawchat.android.core.ui.ClawTone
import com.clawchat.android.core.ui.ClawTopBarColors
import com.clawchat.android.core.ui.localizedErrorMessage
import java.time.LocalDate
import java.time.YearMonth
import java.time.temporal.WeekFields
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CalendarScreen(
    onOpenTask: (String) -> Unit = {},
    viewModel: CalendarViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var editing by remember { mutableStateOf<EditorTarget?>(null) }
    // Read observably: the month and weekday names have to follow a locale
    // change without a restart.
    val locale = LocalLocale.current.platformLocale
    val monthLabelFormatter = remember(locale) {
        localizedDateFormatter(locale, "yMMMM")
    }
    val agendaLabelFormatter = remember(locale) {
        localizedDateFormatter(locale, "MMMMdEEEE")
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                navigationIcon = { com.clawchat.android.core.ui.NavigationMenuButton() },
                title = {
                    Text(
                        state.visibleMonth.format(monthLabelFormatter),
                        fontWeight = FontWeight.SemiBold,
                        style = MaterialTheme.typography.titleLarge,
                    )
                },
                actions = {
                    TextButton(onClick = { viewModel.onAction(CalendarAction.ShowToday) }) {
                        Text(stringResource(R.string.calendar_today))
                    }
                    IconButton(onClick = { viewModel.onAction(CalendarAction.ShowPreviousMonth) }) {
                        Icon(
                            Icons.AutoMirrored.Filled.KeyboardArrowLeft,
                            contentDescription = stringResource(R.string.calendar_previous_month),
                        )
                    }
                    IconButton(onClick = { viewModel.onAction(CalendarAction.ShowNextMonth) }) {
                        Icon(
                            Icons.AutoMirrored.Filled.KeyboardArrowRight,
                            contentDescription = stringResource(R.string.calendar_next_month),
                        )
                    }
                },
                colors = ClawTopBarColors(),
            )
        },
        floatingActionButton = {
            SmallFloatingActionButton(
                modifier = Modifier.size(48.dp),
                onClick = { editing = EditorTarget(null) },
                shape = MaterialTheme.shapes.medium,
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ) {
                Icon(
                    Icons.Default.Add,
                    contentDescription = stringResource(R.string.calendar_new_entry),
                )
            }
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 4.dp, bottom = 88.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (state.isOffline) {
                item {
                    ClawStatusChip(
                        text = stringResource(R.string.calendar_offline_last_synced_month),
                        tone = ClawTone.Error,
                    )
                }
            }

            state.error?.let { message ->
                item {
                    ClawStatusChip(text = localizedErrorMessage(message), tone = ClawTone.Error)
                }
            }

            item {
                ClawSectionCard {
                    MonthGrid(
                        locale = locale,
                        month = state.visibleMonth,
                        selectedDate = state.selectedDate,
                        eventsByDate = state.eventsByDate,
                        tasksByDate = state.tasksByDate,
                        onSelect = { viewModel.onAction(CalendarAction.SelectDate(it)) },
                    )
                }
            }

            item {
                Text(
                    state.selectedDate.format(agendaLabelFormatter),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
            }

            items(
                items = state.selectedTasks,
                key = { it.todo.id },
            ) { segment ->
                TaskRow(segment = segment, onClick = { onOpenTask(segment.todo.id) })
            }

            if (state.selectedEvents.isEmpty() && state.selectedTasks.isEmpty()) {
                item {
                    ClawEmptyState(
                        title = stringResource(R.string.calendar_nothing_scheduled),
                        description = stringResource(R.string.calendar_nothing_scheduled_description),
                        actionLabel = stringResource(R.string.calendar_new_entry),
                        onActionClick = { editing = EditorTarget(null) },
                    )
                }
            }

            if (state.selectedEvents.isNotEmpty()) {
                items(
                    items = state.selectedEvents,
                    key = { it.occurrenceKey },
                ) { event ->
                    EventRow(
                        event = event,
                        onClick = { editing = EditorTarget(event) },
                        onDelete = { viewModel.onAction(CalendarAction.Delete(event)) },
                    )
                }
            }
        }
    }

    editing?.let { target ->
        EventEditorSheet(
            event = target.event,
            defaultDate = state.selectedDate,
            onDismiss = { editing = null },
            onCreateTask = {
                viewModel.onAction(CalendarAction.CreateTask(it))
                editing = null
            },
            onUpdate = { id, update ->
                viewModel.onAction(CalendarAction.Update(id, update))
                editing = null
            },
        )
    }
}

/** Wrapper so "create" (a null event) is still a non-null editor state. */
private data class EditorTarget(val event: Event?)

@Composable
private fun MonthGrid(
    locale: Locale,
    month: YearMonth,
    selectedDate: LocalDate,
    eventsByDate: Map<LocalDate, List<Event>>,
    tasksByDate: Map<LocalDate, List<TaskSegment>>,
    onSelect: (LocalDate) -> Unit,
) {
    val firstDayOfWeek = WeekFields.of(locale).firstDayOfWeek
    val days = remember(month, firstDayOfWeek) { monthGrid(month, firstDayOfWeek) }
    val today = LocalDate.now()

    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(modifier = Modifier.fillMaxWidth()) {
            weekdayLabels(firstDayOfWeek, locale).forEach { label ->
                Text(
                    text = label,
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
            }
        }
        days.chunked(7).forEach { week ->
            Row(modifier = Modifier.fillMaxWidth()) {
                week.forEach { day ->
                    DayCell(
                        day = day,
                        inMonth = YearMonth.from(day) == month,
                        isToday = day == today,
                        isSelected = day == selectedDate,
                        eventCount = eventsByDate[day]?.size ?: 0,
                        taskSegments = tasksByDate[day].orEmpty(),
                        modifier = Modifier.weight(1f),
                        onClick = { onSelect(day) },
                    )
                }
            }
        }
    }
}

@Composable
private fun DayCell(
    day: LocalDate,
    inMonth: Boolean,
    isToday: Boolean,
    isSelected: Boolean,
    eventCount: Int,
    taskSegments: List<TaskSegment>,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val container = when {
        isSelected -> MaterialTheme.colorScheme.primary
        else -> androidx.compose.ui.graphics.Color.Transparent
    }
    val content = when {
        isSelected -> MaterialTheme.colorScheme.onPrimary
        !inMonth -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
        else -> MaterialTheme.colorScheme.onSurface
    }

    Box(
        modifier = modifier
            .aspectRatio(1f)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(30.dp)
                    .clip(CircleShape)
                    .background(container)
                    .then(
                        if (isToday && !isSelected) {
                            Modifier.border(1.dp, MaterialTheme.colorScheme.primary, CircleShape)
                        } else {
                            Modifier
                        },
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = day.dayOfMonth.toString(),
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = if (isToday || isSelected) FontWeight.SemiBold else FontWeight.Normal,
                    color = content,
                )
            }
            // Deadline bars run edge to edge so neighbouring days join into
            // one stretch rather than reading as separate marks.
            taskSegments.take(MAX_TASK_BARS_PER_DAY).forEach { segment ->
                TaskBar(segment = segment)
            }

            Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                repeat(minOf(eventCount, 3)) {
                    Box(
                        modifier = Modifier
                            .size(4.dp)
                            .clip(CircleShape)
                            .background(
                                if (isSelected) {
                                    MaterialTheme.colorScheme.onPrimary
                                } else {
                                    MaterialTheme.colorScheme.primary
                                },
                            ),
                    )
                }
                if (eventCount == 0) Spacer(Modifier.height(4.dp))
            }
        }
    }
}

/** How many deadline bars a day cell shows before the rest are left implied. */
private const val MAX_TASK_BARS_PER_DAY = 2

@Composable
private fun TaskBar(segment: TaskSegment) {
    val color = if (segment.isOverdue) {
        MaterialTheme.colorScheme.error
    } else {
        MaterialTheme.colorScheme.secondary
    }
    val startPad = when (segment.position) {
        TaskSegmentPosition.START, TaskSegmentPosition.SINGLE -> 3.dp
        else -> 0.dp
    }
    val endPad = when (segment.position) {
        TaskSegmentPosition.END, TaskSegmentPosition.SINGLE -> 3.dp
        else -> 0.dp
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = startPad, end = endPad)
            .height(4.dp)
            .clip(RoundedCornerShape(2.dp))
            .background(color),
    )
}

@Composable
private fun TaskRow(segment: TaskSegment, onClick: () -> Unit) {
    val dueLabel = if (segment.isOverdue) {
        stringResource(R.string.calendar_task_overdue)
    } else {
        stringResource(R.string.calendar_task_due)
    }

    ClawListItemSurface(onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    dueLabel,
                    style = MaterialTheme.typography.labelMedium,
                    color = if (segment.isOverdue) {
                        MaterialTheme.colorScheme.error
                    } else {
                        MaterialTheme.colorScheme.secondary
                    },
                )
                Text(
                    segment.todo.title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                )
            }
        }
    }
}

@Composable
private fun EventRow(event: Event, onClick: () -> Unit, onDelete: () -> Unit) {
    val locale = LocalLocale.current.platformLocale
    val context = androidx.compose.ui.platform.LocalContext.current
    val is24Hour = DateFormat.is24HourFormat(context)
    val timeFormatter = remember(locale, is24Hour) {
        localizedTimeFormatter(locale, is24Hour)
    }
    val allDayLabel = stringResource(R.string.calendar_all_day)

    ClawListItemSurface(onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    eventTimeLabel(
                        event.startTime,
                        event.endTime,
                        event.isAllDay,
                        allDayLabel = allDayLabel,
                        timeFormatter = timeFormatter,
                    ),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
                Text(
                    event.title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                )
            }
            if (event.isOccurrence) {
                ClawStatusChip(
                    text = stringResource(R.string.calendar_repeats),
                    tone = ClawTone.Default,
                )
                Spacer(Modifier.width(8.dp))
            }
            IconButton(onClick = onDelete) {
                Icon(
                    Icons.Default.Delete,
                    contentDescription = stringResource(R.string.calendar_delete_event),
                    tint = MaterialTheme.colorScheme.error,
                )
            }
        }
    }
}
