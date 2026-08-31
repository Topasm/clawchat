package com.clawchat.android.core.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.annotation.StringRes
import com.clawchat.android.core.R

private val REMINDER_OPTIONS = listOf(
    ReminderOption(null, R.string.reminder_none),
    ReminderOption(5, R.string.reminder_5_minutes_before),
    ReminderOption(10, R.string.reminder_10_minutes_before),
    ReminderOption(15, R.string.reminder_15_minutes_before),
    ReminderOption(30, R.string.reminder_30_minutes_before),
    ReminderOption(60, R.string.reminder_1_hour_before),
    ReminderOption(120, R.string.reminder_2_hours_before),
    ReminderOption(1440, R.string.reminder_1_day_before),
)

private data class ReminderOption(
    val minutes: Int?,
    @StringRes val labelRes: Int,
)

@Composable
fun ReminderMinutesPicker(
    selectedMinutes: Int?,
    onSelectionChange: (Int?) -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }
    val selectedOption = REMINDER_OPTIONS.find { it.minutes == selectedMinutes }
    val selectedLabel = when {
        selectedOption != null -> stringResource(selectedOption.labelRes)
        selectedMinutes != null -> pluralStringResource(
            R.plurals.reminder_minutes_before,
            selectedMinutes,
            selectedMinutes,
        )
        else -> stringResource(R.string.reminder_none)
    }

    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.Default.Notifications,
            contentDescription = null,
            modifier = Modifier.size(20.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.width(8.dp))
        Box {
            OutlinedButton(onClick = { expanded = true }) {
                Text(selectedLabel, style = MaterialTheme.typography.bodyMedium)
            }
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                REMINDER_OPTIONS.forEach { option ->
                    DropdownMenuItem(
                        text = { Text(stringResource(option.labelRes)) },
                        onClick = {
                            onSelectionChange(option.minutes)
                            expanded = false
                        },
                    )
                }
            }
        }
    }
}
