package com.clawchat.android.feature.calendar

import android.text.format.DateFormat
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLocale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.clawchat.android.core.data.model.Event
import com.clawchat.android.core.data.model.EventUpdate
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.ui.ReminderMinutesPicker
import com.clawchat.android.core.ui.datePickerDate
import com.clawchat.android.core.ui.toDatePickerMillis
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId

/**
 * Adds a task to the calendar, or edits one event.
 *
 * A new entry is always a task: this workspace is task-oriented, so a day
 * picked on the calendar is a deadline to work towards rather than an
 * appointment. Editing an existing event stays an event.
 *
 * Editing a repeat edits the whole series, which is what the server offers;
 * only deleting can single a repeat out.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EventEditorSheet(
    event: Event?,
    defaultDate: LocalDate,
    onDismiss: () -> Unit,
    onCreateTask: (TodoCreate) -> Unit,
    onUpdate: (String, EventUpdate) -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val context = LocalContext.current
    val locale = LocalLocale.current.platformLocale
    val is24Hour = DateFormat.is24HourFormat(context)
    val dateFormatter = remember(locale) { localizedDateFormatter(locale, "yMMMdE") }
    val timeFormatter = remember(locale, is24Hour) {
        localizedTimeFormatter(locale, is24Hour)
    }

    // A new entry is always a task; only editing ever concerns an event.
    val addsTask = event == null
    var title by remember { mutableStateOf(event?.title.orEmpty()) }
    var isAllDay by remember { mutableStateOf(event?.isAllDay == true) }
    var reminderMinutes by remember { mutableStateOf(event?.reminderMinutes) }
    var date by remember {
        mutableStateOf(event?.let { eventDate(it.startTime) } ?: defaultDate)
    }
    var startTime by remember {
        mutableStateOf(parseEventDateTime(event?.startTime)?.toLocalTime() ?: LocalTime.of(9, 0))
    }
    var endTime by remember {
        mutableStateOf(parseEventDateTime(event?.endTime)?.toLocalTime())
    }

    var showDatePicker by remember { mutableStateOf(false) }
    var editingTime by remember { mutableStateOf<TimeField?>(null) }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                stringResource(
                    if (event != null) R.string.calendar_edit_event else R.string.calendar_new_task,
                ),
                style = MaterialTheme.typography.titleLarge,
            )

            OutlinedTextField(
                value = title,
                onValueChange = { title = it },
                label = { Text(stringResource(R.string.calendar_title)) },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )

            if (!addsTask) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        stringResource(R.string.calendar_all_day),
                        style = MaterialTheme.typography.bodyLarge,
                    )
                    Switch(checked = isAllDay, onCheckedChange = { isAllDay = it })
                }
            }

            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                AssistChip(
                    onClick = { showDatePicker = true },
                    label = { Text(date.format(dateFormatter)) },
                )
                if (!isAllDay && !addsTask) {
                    AssistChip(
                        onClick = { editingTime = TimeField.Start },
                        label = { Text(startTime.format(timeFormatter)) },
                    )
                    AssistChip(
                        onClick = { editingTime = TimeField.End },
                        label = {
                            Text(
                                endTime?.format(timeFormatter)
                                    ?: stringResource(R.string.calendar_end),
                            )
                        },
                    )
                }
            }

            if (addsTask) {
                Text(
                    stringResource(R.string.calendar_task_span_hint),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                ReminderMinutesPicker(
                    selectedMinutes = reminderMinutes,
                    onSelectionChange = { reminderMinutes = it },
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(onClick = onDismiss) {
                    Text(stringResource(R.string.calendar_cancel))
                }
                Spacer(Modifier.width(8.dp))
                Button(
                    onClick = {
                        if (addsTask) {
                            onCreateTask(
                                TodoCreate(
                                    title = title.trim(),
                                    // End of the chosen day: the deadline is
                                    // "by then", not "at midnight".
                                    dueDate = LocalDateTime.of(date, LocalTime.of(23, 59))
                                        .toString(),
                                ),
                            )
                        } else {
                            checkNotNull(event) { "Only editing an existing event reaches here." }
                            val start = LocalDateTime.of(
                                date,
                                if (isAllDay) LocalTime.MIDNIGHT else startTime,
                            )
                            val end = endTime
                                ?.takeIf { !isAllDay }
                                ?.let { LocalDateTime.of(date, it).toString() }
                            onUpdate(
                                event.recurringEventId ?: event.id,
                                EventUpdate(
                                    title = title.trim(),
                                    startTime = start.toString(),
                                    endTime = end,
                                    isAllDay = isAllDay,
                                    reminderMinutes = reminderMinutes,
                                ),
                            )
                        }
                    },
                    enabled = title.trim().isNotBlank(),
                    colors = ButtonDefaults.buttonColors(),
                ) {
                    Text(
                        stringResource(
                            if (event == null) R.string.calendar_create else R.string.calendar_save,
                        ),
                    )
                }
            }
        }
    }

    if (showDatePicker) {
        val pickerState = rememberDatePickerState(
            initialSelectedDateMillis = date.toDatePickerMillis(),
        )
        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                TextButton(onClick = {
                    pickerState.selectedDateMillis?.let { millis ->
                        date = datePickerDate(millis)
                    }
                    showDatePicker = false
                }) { Text(stringResource(R.string.calendar_ok)) }
            },
            dismissButton = {
                TextButton(onClick = { showDatePicker = false }) {
                    Text(stringResource(R.string.calendar_cancel))
                }
            },
        ) {
            DatePicker(state = pickerState)
        }
    }

    editingTime?.let { field ->
        val initial = when (field) {
            TimeField.Start -> startTime
            TimeField.End -> endTime ?: startTime.plusHours(1)
        }
        val pickerState = rememberTimePickerState(
            initialHour = initial.hour,
            initialMinute = initial.minute,
            is24Hour = is24Hour,
        )
        AlertDialog(
            onDismissRequest = { editingTime = null },
            confirmButton = {
                TextButton(onClick = {
                    val picked = LocalTime.of(pickerState.hour, pickerState.minute)
                    when (field) {
                        TimeField.Start -> startTime = picked
                        TimeField.End -> endTime = picked
                    }
                    editingTime = null
                }) { Text(stringResource(R.string.calendar_ok)) }
            },
            dismissButton = {
                TextButton(onClick = { editingTime = null }) {
                    Text(stringResource(R.string.calendar_cancel))
                }
            },
            text = { TimePicker(state = pickerState) },
        )
    }
}

private enum class TimeField { Start, End }
