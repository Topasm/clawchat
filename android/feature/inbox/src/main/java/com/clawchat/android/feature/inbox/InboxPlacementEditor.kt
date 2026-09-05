package com.clawchat.android.feature.inbox

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.ui.localizedErrorMessage
import com.clawchat.android.core.ui.ClawSelectionRow

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun InboxPlacementEditor(
    state: InboxPlacementState,
    task: Todo,
    viewModel: InboxPlacementViewModel,
    onDismiss: () -> Unit,
) {
    val snapshot = state.snapshot ?: return
    val initial = state.choices[task.id]
    val baseRevision = rememberSaveable(task.id) { snapshot.graph.revision }
    var projectId by rememberSaveable(task.id) { mutableStateOf(initial?.projectId) }
    var parentId by rememberSaveable(task.id) { mutableStateOf(initial?.parentId) }
    var selected by rememberSaveable(task.id) { mutableStateOf(initial != null) }
    var includeDeadline by rememberSaveable(task.id) { mutableStateOf(task.id !in state.excludedDeadlines) }
    val changed = snapshot.graph.revision != baseRevision
    val enabled = !state.busy && !state.loading && !state.stale && !changed
    val locale = LocalConfiguration.current.locales[0]
    val project = snapshot.projects.find { it.id == projectId }
    val options = remember(project, snapshot.graph, task.id) {
        project?.let { inboxParentOptions(it, snapshot.graph.nodes, task.id) }.orEmpty()
    }
    // A null AI parent means the project root; make that selection explicit in the editor.
    val effectiveParent = parentId ?: project?.rootTaskId
    val valid = selected && (projectId == null || project != null &&
        (effectiveParent == null || options.any { it.id == effectiveParent }))
    ModalBottomSheet(onDismissRequest = { if (!state.busy) onDismiss() }) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
            Text(task.title, style = MaterialTheme.typography.titleMedium)
            LazyColumn(Modifier.weight(1f, fill = false), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item {
                    Text(stringResource(R.string.inbox_editor_location), style = MaterialTheme.typography.titleSmall)
                    ClawSelectionRow(selected = selected && projectId == null, enabled = enabled,
                        onClick = { selected = true; projectId = null; parentId = null },
                        label = stringResource(R.string.inbox_placement_standalone))
                }
                items(snapshot.projects, key = { "project:${it.id}" }) { candidate ->
                    ClawSelectionRow(selected = projectId == candidate.id, enabled = enabled,
                        onClick = { selected = true; projectId = candidate.id; parentId = candidate.rootTaskId },
                        label = candidate.title)
                }
                if (project != null) {
                    item { Text(stringResource(R.string.inbox_editor_parent), style = MaterialTheme.typography.titleSmall) }
                    items(options, key = { "parent:${it.id}" }) { option ->
                        ClawSelectionRow(selected = effectiveParent == option.id, enabled = enabled,
                            onClick = { parentId = option.id }, label = option.path)
                    }
                }
                item {
                    task.dueDate?.let { Text(stringResource(R.string.inbox_placement_due, inboxDisplayDate(it, locale))) }
                    state.deadlines[task.id]?.let { deadline ->
                        Row {
                            Checkbox(checked = includeDeadline, enabled = enabled, onCheckedChange = { includeDeadline = it })
                            Column {
                                Text(stringResource(R.string.inbox_deadline_proposed, inboxDisplayDate(deadline.localDate, locale)))
                                Text("${deadline.sourceText} · ${deadline.timezone}", style = MaterialTheme.typography.bodySmall)
                                if (includeDeadline && deadline.isPast) Text(stringResource(R.string.inbox_deadline_past), color = MaterialTheme.colorScheme.error)
                            }
                        }
                    }
                    initial?.reason?.let {
                        Text(stringResource(R.string.inbox_editor_reason), style = MaterialTheme.typography.titleSmall)
                        Text(it, style = MaterialTheme.typography.bodySmall)
                    }
                    if (state.stale || changed) Text(stringResource(R.string.inbox_placement_stale), color = MaterialTheme.colorScheme.error)
                    state.error?.let { Text(localizedErrorMessage(it), color = MaterialTheme.colorScheme.error) }
                }
            }
            FlowRow(Modifier.fillMaxWidth().padding(vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = onDismiss, enabled = !state.busy) { Text(stringResource(R.string.inbox_editor_cancel)) }
                Button(enabled = enabled && valid, onClick = {
                    viewModel.editPlacement(task.id, PlacementChoice(projectId, effectiveParent), includeDeadline, baseRevision, onDismiss)
                }) { Text(stringResource(R.string.inbox_editor_save)) }
            }
        }
    }
}
