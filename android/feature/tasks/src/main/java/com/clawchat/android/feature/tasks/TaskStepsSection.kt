package com.clawchat.android.feature.tasks

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.ui.ClawComposer
import com.clawchat.android.core.ui.ClawListItemSurface
import com.clawchat.android.core.ui.ClawSectionCard
import com.clawchat.android.core.ui.localizedErrorMessage

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun TaskStepsSection(
    taskId: String,
    state: TaskStepsState,
    onOpen: (Todo) -> Unit,
    onEdit: (String) -> Unit,
    onAdd: () -> Unit,
    onReload: () -> Unit,
) {
    var adding by rememberSaveable(taskId) { mutableStateOf(false) }
    ClawSectionCard {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(stringResource(R.string.tasks_steps_title), style = MaterialTheme.typography.titleMedium)
            TextButton(onClick = { adding = true }) {
                Icon(Icons.Default.Add, contentDescription = null)
                Text(stringResource(R.string.tasks_step_add))
            }
        }
        if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        state.error?.let {
            Text(localizedErrorMessage(it), color = MaterialTheme.colorScheme.error)
            TextButton(onClick = onReload, enabled = !state.loading && !state.saving) {
                Text(stringResource(R.string.tasks_notes_retry))
            }
        }
        if (!state.loading && state.items.isEmpty() && state.error == null) {
            Text(stringResource(R.string.tasks_steps_empty), style = MaterialTheme.typography.bodyMedium)
        }
        state.items.forEach { step ->
            ClawListItemSurface(onClick = { onOpen(step) }) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(step.title, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                    Text(stringResource(when (step.status) {
                        TaskStatus.COMPLETED -> R.string.tasks_status_completed
                        TaskStatus.IN_PROGRESS -> R.string.tasks_status_in_progress
                        TaskStatus.CANCELLED -> R.string.tasks_status_cancelled
                        else -> R.string.tasks_status_pending
                    }), style = MaterialTheme.typography.labelMedium)
                }
            }
        }
    }
    if (adding) {
        ModalBottomSheet(
            onDismissRequest = { adding = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            contentWindowInsets = { WindowInsets(0, 0, 0, 0) },
        ) {
            ClawComposer(
                value = state.draft, onValueChange = onEdit,
                placeholder = stringResource(R.string.tasks_step_hint),
                enabled = !state.saving,
                actionEnabled = !state.loading && !state.saving && state.draft.isNotBlank(),
                actionIcon = Icons.Default.Add,
                actionLabel = stringResource(R.string.tasks_step_add), onAction = onAdd,
                focusOnOpen = true,
            ) {
                Text(stringResource(R.string.tasks_step_scope), style = MaterialTheme.typography.bodySmall)
                state.error?.let { Text(localizedErrorMessage(it), color = MaterialTheme.colorScheme.error) }
                if (state.saving) LinearProgressIndicator(Modifier.fillMaxWidth())
            }
        }
    }
}
