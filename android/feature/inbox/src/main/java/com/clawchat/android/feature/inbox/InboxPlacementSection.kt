package com.clawchat.android.feature.inbox

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.style.TextOverflow
import com.clawchat.android.core.ui.ClawListItemSurface
import com.clawchat.android.core.ui.localizedErrorMessage

@Composable
internal fun InboxPlacementSection(
    state: InboxPlacementState,
    viewModel: InboxPlacementViewModel,
    onOpenPlacement: (String, String?) -> Unit,
) {
    val tasks = state.snapshot?.tasks.orEmpty()
    val visibleTasks = tasks.filterNot { it.id in state.deferred }
    val locale = LocalConfiguration.current.locales[0]
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.inbox_placement_count, visibleTasks.size), style = MaterialTheme.typography.titleMedium)
        if (state.loading) {
            LinearProgressIndicator(Modifier.fillMaxWidth())
            Text(stringResource(R.string.inbox_placement_loading))
        }
        if (state.stale) Text(stringResource(R.string.inbox_placement_stale), color = MaterialTheme.colorScheme.error)
        state.error?.let { Text(localizedErrorMessage(it), color = MaterialTheme.colorScheme.error) }
        if (state.error != null || state.stale) TextButton(onClick = viewModel::refresh, enabled = !state.busy && !state.loading) {
            Text(stringResource(R.string.inbox_action_retry))
        }
        state.applied?.let { applied ->
            ClawListItemSurface {
                Text(stringResource(R.string.inbox_placement_applied, applied.todo.title))
                FlowRow {
                    TextButton(onClick = { onOpenPlacement(applied.todo.id, applied.todo.projectId) }) { Text(stringResource(R.string.inbox_placement_open)) }
                    TextButton(onClick = viewModel::undo, enabled = !state.busy) { Text(stringResource(R.string.inbox_placement_undo)) }
                }
            }
        }
        for (task in visibleTasks) key(task.id) {
            var choosing by remember { mutableStateOf(false) }
            val choice = state.choices[task.id]
            val project = state.snapshot?.projects?.find { it.id == choice?.projectId }
            val parent = state.snapshot?.graph?.nodes?.find { it.id == choice?.parentId }
            val destination = when {
                choice == null -> stringResource(R.string.inbox_placement_choose)
                choice.projectId == null -> stringResource(R.string.inbox_placement_standalone)
                parent != null && parent.id != project?.rootTaskId -> "${project?.title.orEmpty()} › ${parent.title}"
                else -> project?.title.orEmpty()
            }
            ClawListItemSurface {
                Text(task.title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(destination, style = MaterialTheme.typography.bodyMedium)
                task.dueDate?.let { Text(stringResource(R.string.inbox_placement_due, inboxDisplayDate(it, locale)), style = MaterialTheme.typography.bodySmall) }
                state.deadlines[task.id]?.takeUnless { task.id in state.excludedDeadlines }?.let { deadline ->
                    Text(stringResource(R.string.inbox_placement_due, inboxDisplayDate(deadline.localDate, locale)), style = MaterialTheme.typography.bodySmall)
                    if (deadline.isPast) Text(stringResource(R.string.inbox_deadline_past), color = MaterialTheme.colorScheme.error)
                }
                FlowRow {
                    FilledTonalButton(
                        onClick = { viewModel.approve(task.id) },
                        enabled = choice != null && !state.loading && !state.busy && !state.stale,
                    ) { Text(stringResource(R.string.inbox_placement_approve)) }
                    TextButton(onClick = { choosing = true }, enabled = state.snapshot != null && !state.loading && !state.busy && !state.stale) {
                        Text(stringResource(R.string.inbox_placement_edit))
                    }
                    TextButton(onClick = { viewModel.defer(task.id) }, enabled = !state.busy && !state.loading) { Text(stringResource(R.string.inbox_placement_defer)) }
                }
            }
            if (choosing) InboxPlacementEditor(state, task, viewModel) { choosing = false }
        }
        if (state.deferred.isNotEmpty()) TextButton(onClick = viewModel::resumeDeferred, enabled = !state.busy) {
            Text(stringResource(R.string.inbox_placement_deferred))
        }
        state.snapshot?.let {
            if (it.total > it.tasks.size) {
                Text(stringResource(R.string.inbox_placement_more, it.tasks.size, it.total))
                FlowRow {
                    TextButton(onClick = { viewModel.changePage(-1) }, enabled = state.page > 1 && !state.busy && !state.loading) {
                        Text(stringResource(R.string.inbox_placement_previous))
                    }
                    TextButton(onClick = { viewModel.changePage(1) }, enabled = state.page * 50 < it.total && !state.busy && !state.loading) {
                        Text(stringResource(R.string.inbox_placement_next))
                    }
                }
            }
        }
    }
}
