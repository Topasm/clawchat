package com.clawchat.android.feature.inbox

import android.content.ClipData
import androidx.compose.foundation.draganddrop.dragAndDropSource
import androidx.compose.foundation.draganddrop.dragAndDropTarget
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draganddrop.*
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import com.clawchat.android.core.data.model.Note
import com.clawchat.android.core.data.model.ProjectPlan
import kotlinx.coroutines.delay

private const val NOTE_MIME = "application/x-agent-todo-note"
private data class NoteDrag(val workspace: String, val id: String)

@Composable
fun InboxNotesPanel(viewModel: InboxNotesViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle, viewModel) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) { viewModel.refresh(); delay(5_000) }
        }
    }
    key(state.workspace) { NotesContent(state, viewModel) }
}

@Composable
private fun NotesContent(state: InboxNotesState, viewModel: InboxNotesViewModel) {
    var editing by remember { mutableStateOf<Note?>(null) }
    val destinations = listOf(ProjectPlan("", stringResource(R.string.inbox_note_unfiled))) + state.projects
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.inbox_note_drag_hint), style = MaterialTheme.typography.bodySmall)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(destinations, key = { it.id }) { project ->
                NoteProjectTarget(project, state, viewModel)
            }
        }
        if (state.error) Text(stringResource(R.string.inbox_note_error), color = MaterialTheme.colorScheme.error)
        if (state.undoMove != null) Row {
            Text(stringResource(R.string.inbox_note_moved), modifier = Modifier.weight(1f))
            TextButton(onClick = viewModel::undo, enabled = !state.busy) { Text(stringResource(R.string.inbox_note_undo)) }
        }
        val visible = state.notes.filter { it.projectId == state.projectId }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(vertical = 8.dp)) {
            if (visible.isEmpty()) item {
                Text(stringResource(if (state.loading) R.string.inbox_loading else R.string.inbox_note_empty))
            }
            items(visible, key = { it.id }) { note ->
                NoteCard(note, state, destinations, { editing = note }, viewModel::move)
            }
        }
        OutlinedTextField(
            value = state.draft, onValueChange = { if (it.length <= 20_000) viewModel.draft(it) },
            placeholder = { Text(stringResource(R.string.inbox_note_hint)) },
            modifier = Modifier.fillMaxWidth(), minLines = 2, maxLines = 5, enabled = !state.busy,
        )
        Button(onClick = viewModel::create, enabled = !state.busy && state.draft.isNotBlank(), modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
            Text(stringResource(R.string.inbox_note_add))
        }
    }
    editing?.let { original ->
        var content by remember(original.id) { mutableStateOf(original.content) }
        var confirmDelete by remember(original.id) { mutableStateOf(false) }
        AlertDialog(
            onDismissRequest = { if (!state.busy) editing = null },
            title = { Text(stringResource(if (confirmDelete) R.string.inbox_note_delete_confirm else R.string.inbox_note_edit)) },
            text = {
                if (!confirmDelete) Column {
                    OutlinedTextField(value = content, onValueChange = { if (it.length <= 20_000) content = it },
                        minLines = 5, maxLines = 12, enabled = !state.busy, modifier = Modifier.fillMaxWidth())
                    if (state.error) Text(stringResource(R.string.inbox_note_error), color = MaterialTheme.colorScheme.error)
                    TextButton(onClick = { confirmDelete = true }, enabled = !state.busy) { Text(stringResource(R.string.inbox_note_delete)) }
                }
            },
            confirmButton = {
                TextButton(enabled = !state.busy && (confirmDelete || content.isNotBlank()), onClick = {
                    if (confirmDelete) viewModel.delete(original.id) { editing = null }
                    else viewModel.edit(original.id, content) { editing = null }
                }) { Text(stringResource(if (confirmDelete) R.string.inbox_note_delete else R.string.inbox_note_save)) }
            },
            dismissButton = { TextButton(enabled = !state.busy, onClick = { if (confirmDelete) confirmDelete = false else editing = null }) { Text(stringResource(R.string.inbox_note_cancel)) } },
        )
    }
}

@Composable
private fun NoteProjectTarget(project: ProjectPlan, state: InboxNotesState, viewModel: InboxNotesViewModel) {
    var hovering by remember { mutableStateOf(false) }
    val current by rememberUpdatedState(state)
    val projectId = project.id.ifEmpty { null }
    val target = remember(project.id, viewModel) { object : DragAndDropTarget {
        override fun onEntered(event: DragAndDropEvent) { hovering = true }
        override fun onExited(event: DragAndDropEvent) { hovering = false }
        override fun onEnded(event: DragAndDropEvent) { hovering = false }
        override fun onDrop(event: DragAndDropEvent): Boolean {
            hovering = false
            val drag = event.toAndroidDragEvent().localState as? NoteDrag ?: return false
            if (drag.workspace != current.workspace || current.busy || current.notes.none { it.id == drag.id }) return false
            viewModel.move(drag.id, projectId)
            return true
        }
    } }
    FilterChip(
        selected = hovering || state.projectId == projectId,
        onClick = { viewModel.selectProject(projectId) },
        label = { Column { Text(project.title); Text(state.notes.count { it.projectId == projectId }.toString(), style = MaterialTheme.typography.labelSmall) } },
        enabled = !state.busy,
        modifier = Modifier.heightIn(min = 64.dp).dragAndDropTarget(
            shouldStartDragAndDrop = { it.mimeTypes().contains(NOTE_MIME) }, target = target,
        ),
    )
}

@Composable
private fun NoteCard(note: Note, state: InboxNotesState, destinations: List<ProjectPlan>, onEdit: () -> Unit, onMove: (String, String?) -> Unit) {
    var menu by remember { mutableStateOf(false) }
    val drag = if (state.busy || state.workspace == null) Modifier else Modifier.dragAndDropSource { _ ->
        DragAndDropTransferData(
            clipData = ClipData("Note", arrayOf(NOTE_MIME), ClipData.Item(note.id)),
            localState = NoteDrag(state.workspace, note.id),
        )
    }
    OutlinedCard(onClick = onEdit, enabled = !state.busy, modifier = Modifier.fillMaxWidth().then(drag)) {
        Column(Modifier.padding(16.dp)) {
            Text(note.content.lineSequence().first(), style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
            note.content.substringAfter('\n', "").takeIf { it.isNotBlank() }?.let {
                Text(it, maxLines = 4, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
            }
            Box {
                TextButton(onClick = { menu = true }, enabled = !state.busy) { Text(stringResource(R.string.inbox_note_move)) }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    destinations.forEach { project ->
                        DropdownMenuItem(text = { Text(project.title) }, onClick = {
                            menu = false; onMove(note.id, project.id.ifEmpty { null })
                        })
                    }
                }
            }
        }
    }
}
