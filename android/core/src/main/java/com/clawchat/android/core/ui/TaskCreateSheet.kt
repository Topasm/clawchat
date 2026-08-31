package com.clawchat.android.core.ui

import com.clawchat.android.core.data.model.TodoCreate
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.annotation.StringRes
import com.clawchat.android.core.R

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TaskCreateSheet(
    onDismiss: () -> Unit,
    onCreate: (TodoCreate) -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var title by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var priority by remember { mutableStateOf("medium") }
    var dueDate by remember { mutableStateOf<String?>(null) }
    var showDatePicker by remember { mutableStateOf(false) }
    val focusRequester = remember { FocusRequester() }
    val focusManager = LocalFocusManager.current

    LaunchedEffect(Unit) {
        focusRequester.requestFocus()
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Header
            Text(
                stringResource(R.string.task_create_title),
                style = MaterialTheme.typography.titleLarge,
            )

            // Title field
            OutlinedTextField(
                value = title,
                onValueChange = { title = it },
                label = { Text(stringResource(R.string.task_title_label)) },
                placeholder = { Text(stringResource(R.string.task_title_hint)) },
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(focusRequester),
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
            )

            // Description field
            OutlinedTextField(
                value = description,
                onValueChange = { description = it },
                label = { Text(stringResource(R.string.task_notes_label)) },
                placeholder = { Text(stringResource(R.string.task_notes_hint)) },
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 80.dp),
                maxLines = 4,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { focusManager.clearFocus() }),
            )

            // Priority selector
            Text(
                stringResource(R.string.task_priority_label),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                PriorityOption(R.string.task_priority_low, priority == "low", MaterialTheme.colorScheme.outline) {
                    priority = "low"
                }
                PriorityOption(R.string.task_priority_medium, priority == "medium", MaterialTheme.colorScheme.tertiary) {
                    priority = "medium"
                }
                PriorityOption(R.string.task_priority_high, priority == "high", MaterialTheme.colorScheme.error) {
                    priority = "high"
                }
            }

            // Due date row
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    Icons.Default.DateRange,
                    contentDescription = null,
                    modifier = Modifier.size(20.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (dueDate != null) {
                    InputChip(
                        selected = true,
                        onClick = { showDatePicker = true },
                        label = { Text(dueDate!!) },
                        trailingIcon = {
                            IconButton(
                                onClick = { dueDate = null },
                                modifier = Modifier.size(18.dp),
                            ) {
                                Icon(
                                    Icons.Default.Close,
                                    contentDescription = stringResource(R.string.task_clear_due_date),
                                    modifier = Modifier.size(14.dp),
                                )
                            }
                        },
                    )
                } else {
                    TextButton(onClick = { showDatePicker = true }) {
                        Text(stringResource(R.string.task_add_due_date))
                    }
                }
            }

            // Action buttons
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(onClick = onDismiss) {
                    Text(stringResource(R.string.common_cancel))
                }
                Spacer(Modifier.width(8.dp))
                Button(
                    onClick = {
                        val normalizedTitle = title.trim()
                        if (normalizedTitle.isNotBlank()) {
                            onCreate(TodoCreate(
                                title = normalizedTitle,
                                description = description.trim().takeIf { it.isNotEmpty() },
                                priority = priority,
                                dueDate = dueDate,
                            ))
                        }
                    },
                    enabled = title.trim().isNotBlank(),
                ) {
                    Text(stringResource(R.string.task_create_action))
                }
            }
        }
    }

    // Date picker dialog
    if (showDatePicker) {
        val datePickerState = rememberDatePickerState()
        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                TextButton(onClick = {
                    datePickerState.selectedDateMillis?.let { millis ->
                        val instant = java.time.Instant.ofEpochMilli(millis)
                        val localDate = instant.atZone(java.time.ZoneId.systemDefault()).toLocalDate()
                        dueDate = localDate.toString()
                    }
                    showDatePicker = false
                }) { Text(stringResource(R.string.common_ok)) }
            },
            dismissButton = {
                TextButton(onClick = { showDatePicker = false }) {
                    Text(stringResource(R.string.common_cancel))
                }
            },
        ) {
            DatePicker(state = datePickerState)
        }
    }
}

@Composable
private fun PriorityOption(
    @StringRes labelRes: Int,
    isSelected: Boolean,
    color: androidx.compose.ui.graphics.Color,
    onClick: () -> Unit,
) {
    FilterChip(
        selected = isSelected,
        onClick = onClick,
        label = {
            Text(
                stringResource(labelRes),
                style = MaterialTheme.typography.labelMedium,
            )
        },
        colors = FilterChipDefaults.filterChipColors(
            selectedContainerColor = color.copy(alpha = 0.12f),
            selectedLabelColor = color,
        ),
    )
}
