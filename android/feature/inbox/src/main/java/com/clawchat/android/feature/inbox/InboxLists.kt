package com.clawchat.android.feature.inbox

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.clawchat.android.core.data.model.InboxRouting
import com.clawchat.android.core.data.model.ProjectFolderCandidate
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.ui.ClawEmptyState
import com.clawchat.android.core.ui.ClawListItemSurface
import com.clawchat.android.core.ui.ClawMobileLayout
import com.clawchat.android.core.ui.ClawStatusChip
import com.clawchat.android.core.ui.SwipeToDismissCard
import com.clawchat.android.core.ui.icons.ClawIcons
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * What the Inbox just organized, each with its destination and an undo, then
 * what it was not sure about, each with two choices. A long press under
 * "Needs a look" starts picking several captures to file at once.
 */
@Composable
internal fun InboxLists(
    state: InboxUiState,
    onAction: (InboxAction) -> Unit,
    onOpenTask: (String) -> Unit,
    onOpenNotes: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val selection = state.selection
    val locale = LocalConfiguration.current.locales[0]
    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp),
    ) {
        if (state.routings.isNotEmpty()) {
            item(key = "organized") {
                InboxSectionTitle(stringResource(R.string.inbox_organized_title), state.routings.size)
            }
            items(state.routings, key = { "routing:${it.id}" }) { routing ->
                InboxRoutingRow(
                    routing = routing,
                    detail = routingDetail(routing, state, locale),
                    currentProject = routing.todoId?.let { state.snapshot.projectOf[it] },
                    state = state,
                    onAction = onAction,
                    onOpen = {
                        val todoId = routing.todoId
                        if (routing.isTask && todoId != null) onOpenTask(todoId) else onOpenNotes()
                    },
                )
            }
        }
        if (!state.isEmpty) {
            item(key = "review") {
                InboxSectionTitle(
                    stringResource(R.string.inbox_review_title),
                    state.captures.size,
                    Modifier.padding(top = if (state.routings.isEmpty()) 0.dp else 24.dp),
                ) {
                    if (selection.isNotEmpty()) {
                        TextButton(onClick = { onAction(InboxAction.SelectAll) }) {
                            Text(stringResource(R.string.inbox_select_all))
                        }
                        TextButton(onClick = { onAction(InboxAction.ClearSelection) }) {
                            Text(stringResource(R.string.inbox_cancel))
                        }
                    }
                }
            }
            if (selection.isNotEmpty()) item(key = "selection") {
                InboxSelectionBar(selection.size, state.busy, onAction)
            }
            if (state.captures.isEmpty()) item(key = "nothing") {
                Text(
                    stringResource(R.string.inbox_nothing_to_check),
                    modifier = Modifier.padding(vertical = 12.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            items(state.captures, key = { "capture:${it.id}" }) { todo ->
                InboxCaptureRow(
                    todo = todo,
                    selecting = selection.isNotEmpty(),
                    selected = todo.id in selection,
                    busy = state.busy,
                    onAction = onAction,
                    onOpen = { onOpenTask(todo.id) },
                )
            }
        }
        if (state.isEmpty) item(key = "empty") {
            ClawEmptyState(
                title = stringResource(R.string.inbox_empty_title),
                description = stringResource(R.string.inbox_empty_description),
                icon = {
                    Icon(ClawIcons.Inbox, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                },
            )
        }
        if (state.snapshot.candidates.isNotEmpty()) {
            item(key = "candidates") {
                InboxSectionTitle(stringResource(R.string.inbox_candidates_title), null, Modifier.padding(top = 24.dp))
            }
            items(state.snapshot.candidates, key = { "candidate:${it.sourceName}:${it.folder}" }) { candidate ->
                InboxCandidateRow(candidate, state.busy) { onAction(InboxAction.Import(candidate)) }
            }
        }
    }
}

/** A quiet section title with its count; [actions] sit at the far end, or wrap below when there is no room. */
@Composable
private fun InboxSectionTitle(
    title: String,
    count: Int?,
    modifier: Modifier = Modifier,
    actions: @Composable RowScope.() -> Unit = {},
) {
    FlowRow(
        modifier = modifier.fillMaxWidth().heightIn(min = 40.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            modifier = Modifier.padding(vertical = 8.dp).semantics(mergeDescendants = true) { heading() },
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            if (count != null) {
                Text(count.toString(), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Row(content = actions)
    }
}

@Composable
private fun InboxRoutingRow(
    routing: InboxRouting,
    detail: String,
    currentProject: String?,
    state: InboxUiState,
    onAction: (InboxAction) -> Unit,
    onOpen: () -> Unit,
) {
    var choosing by remember { mutableStateOf(false) }
    ClawListItemSurface(onClick = onOpen) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    routing.title,
                    style = MaterialTheme.typography.bodyLarge,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Box {
                    Row(
                        modifier = Modifier
                            .heightIn(min = ClawMobileLayout.TouchTarget)
                            .clip(MaterialTheme.shapes.small)
                            .clickable(
                                enabled = !state.busy,
                                onClickLabel = stringResource(R.string.inbox_change_destination),
                            ) { choosing = true },
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        ClawStatusChip(
                            stringResource(if (routing.isTask) R.string.inbox_kind_task else R.string.inbox_kind_note),
                        )
                        if (detail.isNotEmpty()) {
                            Text(
                                detail,
                                modifier = Modifier.weight(1f, fill = false),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        Icon(
                            Icons.Default.ArrowDropDown,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    DropdownMenu(expanded = choosing, onDismissRequest = { choosing = false }) {
                        InboxDestinationItem(stringResource(R.string.inbox_kind_task), routing.isTask) {
                            choosing = false
                            if (!routing.isTask) onAction(InboxAction.SwitchKind(routing))
                        }
                        InboxDestinationItem(stringResource(R.string.inbox_kind_note), !routing.isTask) {
                            choosing = false
                            if (routing.isTask) onAction(InboxAction.SwitchKind(routing))
                        }
                        state.snapshot.projects.forEach { project ->
                            val current = routing.isTask && currentProject == project.id
                            InboxDestinationItem(stringResource(R.string.inbox_project_option, project.title), current) {
                                choosing = false
                                if (!current) onAction(InboxAction.MoveToProject(routing, project.id))
                            }
                        }
                    }
                }
            }
            TextButton(onClick = { onAction(InboxAction.Undo(routing.id)) }, enabled = !state.busy) {
                Text(stringResource(R.string.inbox_undo))
            }
        }
    }
}

@Composable
private fun InboxDestinationItem(label: String, current: Boolean, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(label, fontWeight = if (current) FontWeight.SemiBold else null) },
        onClick = onClick,
        modifier = Modifier.semantics { selected = current },
        trailingIcon = if (current) {
            { Icon(Icons.Default.Check, contentDescription = null) }
        } else null,
    )
}

@Composable
private fun InboxSelectionBar(count: Int, busy: Boolean, onAction: (InboxAction) -> Unit) {
    FlowRow(
        modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            stringResource(R.string.inbox_selected, count),
            modifier = Modifier.weight(1f, fill = false).padding(end = 8.dp),
            style = MaterialTheme.typography.bodyMedium,
        )
        OutlinedButton(onClick = { onAction(InboxAction.FileSelection(asTask = true)) }, enabled = !busy) {
            Text(stringResource(R.string.inbox_kind_task))
        }
        OutlinedButton(onClick = { onAction(InboxAction.FileSelection(asTask = false)) }, enabled = !busy) {
            Text(stringResource(R.string.inbox_kind_note))
        }
    }
}

@Composable
private fun InboxCaptureRow(
    todo: Todo,
    selecting: Boolean,
    selected: Boolean,
    busy: Boolean,
    onAction: (InboxAction) -> Unit,
    onOpen: () -> Unit,
) {
    val toggle = { onAction(InboxAction.ToggleSelected(todo.id)) }
    SwipeToDismissCard(onDelete = { onAction(InboxAction.Delete(todo.id)) }) {
        ClawListItemSurface(
            modifier = if (selecting) Modifier.semantics { this.selected = selected } else Modifier,
            onClick = if (selecting) {
                { if (!todo.isOrganizing) toggle() }
            } else onOpen,
            onLongClick = { if (!todo.isOrganizing) toggle() },
        ) {
            val choices: @Composable () -> Unit = {
                OutlinedButton(onClick = { onAction(InboxAction.FileAsTask(todo.id)) }, enabled = !busy) {
                    Text(stringResource(R.string.inbox_kind_task))
                }
                OutlinedButton(onClick = { onAction(InboxAction.FileAsNote(todo.id)) }, enabled = !busy) {
                    Text(stringResource(R.string.inbox_kind_note))
                }
            }
            // With large text the title keeps the full width and the choices drop below it.
            val stacked = LocalDensity.current.fontScale >= 1.5f
            Row(
                modifier = Modifier.heightIn(min = ClawMobileLayout.TouchTarget),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (selecting) Checkbox(checked = selected, onCheckedChange = null, enabled = !todo.isOrganizing)
                Text(
                    todo.title,
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.bodyLarge,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
                when {
                    todo.isOrganizing -> Text(
                        stringResource(R.string.inbox_organizing),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    !selecting && !stacked -> choices()
                }
            }
            if (!selecting && stacked && !todo.isOrganizing) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                ) { choices() }
            }
        }
    }
}

@Composable
private fun InboxCandidateRow(candidate: ProjectFolderCandidate, busy: Boolean, onImport: () -> Unit) {
    ClawListItemSurface {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(candidate.name, style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(
                    candidate.sourceName,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            TextButton(onClick = onImport, enabled = !busy) { Text(stringResource(R.string.inbox_import)) }
        }
    }
}

/** "Due Nov 3 · Thesis": a filed task's deadline and the project, or vault folder, it landed in. */
@Composable
private fun routingDetail(routing: InboxRouting, state: InboxUiState, locale: Locale): String {
    if (!routing.isTask) return ""
    val due = routing.dueDate?.let { inboxShortDay(it, locale) }?.let { stringResource(R.string.inbox_due, it) }
    val project = routing.todoId?.let { state.snapshot.projectOf[it] }
        ?.let { id -> state.snapshot.projects.find { it.id == id }?.title }
    return listOfNotNull(due, project ?: inboxFolderName(routing.projectFolder)).joinToString(" · ")
}

/** "11월 3일" or "Nov 3", on the phone's own calendar. */
internal fun inboxShortDay(value: String, locale: Locale, zone: ZoneId = ZoneId.systemDefault()): String? {
    val date = runCatching { OffsetDateTime.parse(value).atZoneSameInstant(zone).toLocalDate() }
        .recoverCatching { LocalDate.parse(value.take(10)) }
        .getOrNull() ?: return null
    val pattern = if (locale.language == "ko") "M월 d일" else "MMM d"
    return date.format(DateTimeFormatter.ofPattern(pattern, locale))
}

/** The last segment of a vault folder: `01_Projects/Thesis` → `Thesis`. */
internal fun inboxFolderName(folder: String?): String? =
    folder?.split('/')?.lastOrNull { it.isNotBlank() }
