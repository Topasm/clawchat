package com.clawchat.android.feature.calendar

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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalLocale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import com.clawchat.android.core.data.model.Event
import com.clawchat.android.core.ui.ClawEmptyState
import com.clawchat.android.core.ui.ClawListItemSurface
import com.clawchat.android.core.ui.ClawSectionCard
import com.clawchat.android.core.ui.ClawStatusChip
import com.clawchat.android.core.ui.ClawTone
import com.clawchat.android.core.ui.ClawTopBarColors
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.time.temporal.WeekFields
import java.util.Locale

private val MONTH_LABEL = DateTimeFormatter.ofPattern("MMMM yyyy")
private val AGENDA_LABEL = DateTimeFormatter.ofPattern("EEEE, d MMMM")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CalendarScreen(viewModel: CalendarViewModel = hiltViewModel()) {
    val state by viewModel.uiState.collectAsState()
    var editing by remember { mutableStateOf<EditorTarget?>(null) }
    // Read observably: the month and weekday names have to follow a locale
    // change without a restart.
    val locale = LocalLocale.current.platformLocale

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        state.visibleMonth.format(MONTH_LABEL.withLocale(locale)),
                        fontWeight = FontWeight.SemiBold,
                        style = MaterialTheme.typography.headlineSmall,
                    )
                },
                actions = {
                    TextButton(onClick = { viewModel.onAction(CalendarAction.ShowToday) }) {
                        Text("Today")
                    }
                    IconButton(onClick = { viewModel.onAction(CalendarAction.ShowPreviousMonth) }) {
                        Icon(Icons.Default.KeyboardArrowLeft, contentDescription = "Previous month")
                    }
                    IconButton(onClick = { viewModel.onAction(CalendarAction.ShowNextMonth) }) {
                        Icon(Icons.Default.KeyboardArrowRight, contentDescription = "Next month")
                    }
                },
                colors = ClawTopBarColors(),
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { editing = EditorTarget(null) },
                icon = { Icon(Icons.Default.Add, contentDescription = null) },
                text = { Text("New event") },
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 120.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (state.isOffline) {
                item {
                    ClawStatusChip(
                        text = "Offline — showing the last synced month",
                        tone = ClawTone.Error,
                    )
                }
            }

            state.error?.let { message ->
                item {
                    ClawStatusChip(text = message, tone = ClawTone.Error)
                }
            }

            item {
                ClawSectionCard {
                    MonthGrid(
                        locale = locale,
                        month = state.visibleMonth,
                        selectedDate = state.selectedDate,
                        eventsByDate = state.eventsByDate,
                        onSelect = { viewModel.onAction(CalendarAction.SelectDate(it)) },
                    )
                }
            }

            item {
                Text(
                    state.selectedDate.format(AGENDA_LABEL.withLocale(locale)),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
            }

            if (state.selectedEvents.isEmpty()) {
                item {
                    ClawEmptyState(
                        title = "Nothing scheduled",
                        description = "Add an event for this day, or pick another date above.",
                        actionLabel = "New event",
                        onActionClick = { editing = EditorTarget(null) },
                    )
                }
            } else {
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
            onCreate = {
                viewModel.onAction(CalendarAction.Create(it))
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

@Composable
private fun EventRow(event: Event, onClick: () -> Unit, onDelete: () -> Unit) {
    ClawListItemSurface(onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    eventTimeLabel(event.startTime, event.endTime, event.isAllDay),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
                Text(
                    event.title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                )
                event.location?.takeIf { it.isNotBlank() }?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (event.isOccurrence) {
                ClawStatusChip(text = "Repeats", tone = ClawTone.Default)
                Spacer(Modifier.width(8.dp))
            }
            IconButton(onClick = onDelete) {
                Icon(
                    Icons.Default.Delete,
                    contentDescription = "Delete event",
                    tint = MaterialTheme.colorScheme.error,
                )
            }
        }
    }
}
