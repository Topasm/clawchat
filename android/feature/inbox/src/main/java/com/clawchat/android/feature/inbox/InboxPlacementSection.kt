package com.clawchat.android.feature.inbox

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.clawchat.android.core.ui.ClawListItemSurface
import com.clawchat.android.core.ui.localizedErrorMessage

@Composable
internal fun InboxPlacementSection(
    state: InboxPlacementState,
    viewModel: InboxPlacementViewModel,
    onTaskClick: (String) -> Unit,
) {
    val tasks = state.snapshot?.tasks.orEmpty()
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.inbox_placement_title), style = MaterialTheme.typography.titleMedium)
        Text(stringResource(R.string.inbox_placement_help), style = MaterialTheme.typography.bodySmall)
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
                    TextButton(onClick = { onTaskClick(applied.todo.id) }) { Text(stringResource(R.string.inbox_placement_open)) }
                    TextButton(onClick = viewModel::undo, enabled = !state.busy) { Text(stringResource(R.string.inbox_placement_undo)) }
                }
            }
        }
        for (task in tasks.filterNot { it.id in state.deferred }) key(task.id) {
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
                Text(task.title, style = MaterialTheme.typography.titleSmall)
                Text(destination, style = MaterialTheme.typography.bodyMedium)
                task.dueDate?.let { Text(stringResource(R.string.inbox_placement_due, it), style = MaterialTheme.typography.bodySmall) }
                state.deadlines[task.id]?.let { deadline ->
                    Row {
                        Checkbox(checked = task.id !in state.excludedDeadlines,
                            onCheckedChange = { viewModel.includeDeadline(task.id, it) },
                            enabled = !state.loading && !state.busy && !state.stale)
                        Column {
                            Text(stringResource(R.string.inbox_deadline_proposed, deadline.localDate), style = MaterialTheme.typography.bodyMedium)
                            Text("${deadline.sourceText} · ${deadline.timezone}", style = MaterialTheme.typography.bodySmall)
                            if (deadline.isPast) Text(stringResource(R.string.inbox_deadline_past), color = MaterialTheme.colorScheme.error)
                        }
                    }
                }
                choice?.reason?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                FlowRow {
                    FilledTonalButton(
                        onClick = { viewModel.approve(task.id) },
                        enabled = choice != null && !state.loading && !state.busy && !state.stale,
                    ) { Text(stringResource(R.string.inbox_placement_approve)) }
                    Box {
                        TextButton(onClick = { choosing = true }, enabled = state.snapshot != null && !state.loading && !state.busy && !state.stale) {
                            Text(stringResource(R.string.inbox_placement_edit))
                        }
                        DropdownMenu(expanded = choosing, onDismissRequest = { choosing = false }) {
                            DropdownMenuItem(text = { Text(stringResource(R.string.inbox_placement_standalone)) }, onClick = {
                                viewModel.choose(task.id, null); choosing = false
                            })
                            state.snapshot?.projects?.forEach { candidate ->
                                DropdownMenuItem(text = { Text(candidate.title) }, onClick = {
                                    viewModel.choose(task.id, candidate); choosing = false
                                })
                            }
                        }
                    }
                    TextButton(onClick = { viewModel.defer(task.id) }, enabled = !state.busy) { Text(stringResource(R.string.inbox_placement_defer)) }
                }
            }
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
