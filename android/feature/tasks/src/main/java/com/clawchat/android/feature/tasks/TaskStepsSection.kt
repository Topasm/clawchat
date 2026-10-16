package com.clawchat.android.feature.tasks

import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoPath
import com.clawchat.android.core.ui.ClawComposer
import com.clawchat.android.core.ui.ClawListItemSurface
import com.clawchat.android.core.ui.ClawSectionCard
import com.clawchat.android.core.ui.localizedErrorMessage

/**
 * Rows of the flow from top to bottom: a step sits one row below the last of
 * its prerequisites, and steps in the same row are branches.
 */
internal fun flowLayers(items: List<Todo>, edges: List<StepEdge>): List<List<Todo>> {
    val ids = items.map { it.id }.toSet()
    val valid = edges.filter { it.before in ids && it.after in ids && it.before != it.after }.distinct()
    val incoming = items.associate { it.id to 0 }.toMutableMap()
    val outgoing = mutableMapOf<String, MutableList<String>>()
    valid.forEach { edge ->
        incoming[edge.after] = incoming.getValue(edge.after) + 1
        outgoing.getOrPut(edge.before) { mutableListOf() }.add(edge.after)
    }
    val depth = items.associate { it.id to 0 }.toMutableMap()
    val queue = ArrayDeque(items.sortedBy { it.sortOrder }.filter { incoming[it.id] == 0 }.map { it.id })
    val placed = mutableSetOf<String>()
    while (queue.isNotEmpty()) {
        val id = queue.removeFirst()
        placed += id
        outgoing[id]?.forEach { next ->
            depth[next] = maxOf(depth.getValue(next), depth.getValue(id) + 1)
            incoming[next] = incoming.getValue(next) - 1
            if (incoming[next] == 0) queue.add(next)
        }
    }
    // A cycle cannot be ordered; keep its steps visible below the rest.
    var fallback = (depth.values.maxOrNull() ?: 0) + 1
    items.filter { it.id !in placed }.sortedBy { it.sortOrder }.forEach { depth[it.id] = fallback++ }
    return items
        .sortedWith(compareBy<Todo>({ depth.getValue(it.id) }, { it.sortOrder }))
        .groupBy { depth.getValue(it.id) }
        .toSortedMap()
        .values
        .toList()
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun TaskStepsSection(
    state: TaskStepsState,
    /** Titles of prerequisites that belong to other tasks. */
    outsideTitles: List<String>,
    onOpen: (Todo) -> Unit,
    onEdit: (String) -> Unit,
    onAdd: () -> Unit,
    onReload: () -> Unit,
) {
    val layers = remember(state.items, state.edges) { flowLayers(state.items, state.edges) }
    val unfinished = remember(state.items, state.edges) {
        val open = state.items.filter { it.status != TaskStatus.COMPLETED }.map { it.id }.toSet()
        state.edges.filter { it.before in open }.map { it.after }.toSet()
    }
    ClawSectionCard {
        Text(stringResource(R.string.tasks_steps_title), style = MaterialTheme.typography.titleMedium)
        if (outsideTitles.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                outsideTitles.forEach { title ->
                    Text(
                        stringResource(R.string.tasks_flow_other_task, title),
                        modifier = Modifier.alpha(0.6f),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
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
        layers.forEachIndexed { index, layer ->
            if (index > 0) {
                Text(
                    "↓",
                    modifier = Modifier.fillMaxWidth(),
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            // Branches sit side by side, indented so they read as one row.
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = if (layer.size > 1) 12.dp else 0.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                layer.forEach { step ->
                    FlowStep(step, waiting = step.id in unfinished, onOpen = onOpen, modifier = Modifier.weight(1f))
                }
            }
        }
        ClawComposer(
            value = state.draft,
            onValueChange = onEdit,
            placeholder = stringResource(R.string.tasks_step_hint),
            enabled = !state.saving,
            actionEnabled = !state.loading && !state.saving && state.draft.isNotBlank(),
            actionIcon = Icons.Default.Add,
            actionLabel = stringResource(R.string.tasks_step_add),
            onAction = onAdd,
        ) {
            if (state.saving) LinearProgressIndicator(Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun FlowStep(step: Todo, waiting: Boolean, onOpen: (Todo) -> Unit, modifier: Modifier) {
    val done = step.status == TaskStatus.COMPLETED || step.status == TaskStatus.CANCELLED
    val status = when {
        step.status == TaskStatus.COMPLETED -> stringResource(R.string.tasks_status_completed)
        step.status == TaskStatus.CANCELLED -> stringResource(R.string.tasks_status_cancelled)
        step.status == TaskStatus.IN_PROGRESS -> stringResource(R.string.tasks_flow_in_progress)
        waiting -> stringResource(R.string.tasks_flow_waiting)
        else -> null
    }
    ClawListItemSurface(modifier = modifier.alpha(if (done) 0.6f else 1f), onClick = { onOpen(step) }) {
        Text(
            step.title,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            textDecoration = if (step.status == TaskStatus.COMPLETED) TextDecoration.LineThrough else null,
        )
        status?.let {
            Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** Where the task's material lives; a tap copies the path. */
@Composable
internal fun TaskPathsSection(paths: List<TodoPath>) {
    if (paths.isEmpty()) return
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current
    val copied = stringResource(R.string.tasks_paths_copied)
    val web = stringResource(R.string.tasks_paths_web)
    ClawSectionCard {
        Text(stringResource(R.string.tasks_paths_title), style = MaterialTheme.typography.titleMedium)
        paths.forEach { path ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .alpha(if (path.inherited) 0.55f else 1f)
                    .clickable {
                        clipboard.setText(AnnotatedString(path.path))
                        Toast.makeText(context, copied, Toast.LENGTH_SHORT).show()
                    }
                    .padding(vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    when (path.kind) {
                        "url" -> web
                        "vault" -> "vault"
                        else -> path.hostLabel.orEmpty()
                    },
                    modifier = Modifier.widthIn(min = 52.dp),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    path.label ?: path.path,
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}
