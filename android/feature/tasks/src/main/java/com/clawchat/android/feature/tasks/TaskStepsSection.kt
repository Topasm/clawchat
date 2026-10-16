package com.clawchat.android.feature.tasks

import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
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

/** The flow by order: [layers] top to bottom, [unordered] steps kept apart. */
internal data class FlowGrid(val layers: List<List<Todo>>, val unordered: List<Todo>)

/**
 * The web's flow layout turned 90°: a step's layer is its longest chain of
 * prerequisites; within a layer its nearest successor stays in its lane, so
 * the main line comes first and branches sit beside it, and a join takes the
 * first lane of what it follows. Steps with no order at all are kept apart;
 * a lone step starts the flow. Nothing is stored.
 */
internal fun layoutFlow(items: List<Todo>, edges: List<StepEdge>): FlowGrid {
    val byId = items.associateBy { it.id }
    val valid = edges.filter { it.before in byId && it.after in byId && it.before != it.after }.distinct()
    val linked = valid.flatMap { listOf(it.before, it.after) }.toMutableSet()
    if (linked.isEmpty() && items.size == 1) linked += items.single().id
    val order = compareBy<Todo>({ it.sortOrder }, { it.id })
    val flow = items.filter { it.id in linked }.sortedWith(order)
    val before = valid.groupBy({ it.after }, { it.before })
    val after = valid.groupBy({ it.before }, { byId.getValue(it.after) })

    val layer = flow.associate { it.id to 0 }.toMutableMap()
    val waiting = flow.associate { it.id to (before[it.id]?.size ?: 0) }.toMutableMap()
    val queue = ArrayDeque(flow.filter { waiting[it.id] == 0 }.map { it.id })
    val placed = mutableSetOf<String>()
    while (queue.isNotEmpty()) {
        val id = queue.removeFirst()
        placed += id
        after[id].orEmpty().forEach { next ->
            layer[next.id] = maxOf(layer.getValue(next.id), layer.getValue(id) + 1)
            waiting[next.id] = waiting.getValue(next.id) - 1
            if (waiting[next.id] == 0) queue.add(next.id)
        }
    }
    // A cycle cannot be ordered; keep its steps visible below the rest.
    var fallback = (layer.values.maxOrNull() ?: 0) + 1
    flow.filter { it.id !in placed }.forEach { layer[it.id] = fallback++ }

    val nearest = after.mapValues { (_, next) -> next.sortedWith(compareBy<Todo>({ layer.getValue(it.id) }).then(order)).first().id }
    val lane = mutableMapOf<String, Int>()
    val taken = mutableMapOf<Int, MutableSet<Int>>()
    flow.sortedWith(compareBy<Todo>({ layer.getValue(it.id) }).then(order)).forEach { step ->
        val preds = before[step.id].orEmpty().filter { it in lane }
        val leading = preds.filter { nearest[it] == step.id }
        var candidate = when {
            leading.isNotEmpty() -> leading.minOf { lane.getValue(it) }
            preds.isNotEmpty() -> preds.minOf { lane.getValue(it) } + 1
            else -> 0
        }
        val used = taken.getOrPut(layer.getValue(step.id)) { mutableSetOf() }
        while (candidate in used) candidate++
        used += candidate
        lane[step.id] = candidate
    }
    val layers = flow.groupBy { layer.getValue(it.id) }.toSortedMap().values
        .map { steps -> steps.sortedBy { lane.getValue(it.id) } }
    return FlowGrid(layers, items.filter { it.id !in linked }.sortedWith(order))
}

/** Done steps at the start of the flow: done, with everything before them done. */
internal fun doneLead(items: List<Todo>, edges: List<StepEdge>): Set<String> {
    val linked = edges.flatMap { listOf(it.before, it.after) }.toSet()
    val lead = mutableSetOf<String>()
    var grew = true
    while (grew) {
        grew = false
        items.filter {
            it.id !in lead && it.id in linked &&
                (it.status == TaskStatus.COMPLETED || it.status == TaskStatus.CANCELLED)
        }.forEach { step ->
            if (edges.filter { it.after == step.id }.all { it.before in lead }) {
                lead += step.id
                grew = true
            }
        }
    }
    return lead
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
    var showDone by rememberSaveable { mutableStateOf(false) }
    val folded = remember(state.items, state.edges) { doneLead(state.items, state.edges) }
    val fold = !showDone && folded.size > 3
    val grid = remember(state.items, state.edges, fold) {
        if (fold) {
            layoutFlow(
                state.items.filter { it.id !in folded },
                state.edges.filter { it.before !in folded && it.after !in folded },
            )
        } else {
            layoutFlow(state.items, state.edges)
        }
    }
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
        if (fold) {
            ClawListItemSurface(modifier = Modifier.alpha(0.6f), onClick = { showDone = true }) {
                Text(
                    stringResource(R.string.tasks_flow_done_folded, folded.size),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
        grid.layers.forEachIndexed { index, layer ->
            if (index > 0 || fold) {
                Text(
                    "↓",
                    modifier = Modifier.fillMaxWidth(),
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            // The main line comes first; branches sit beside it, indented.
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                layer.forEachIndexed { lane, step ->
                    FlowStep(
                        step,
                        waiting = step.id in unfinished,
                        onOpen = onOpen,
                        modifier = Modifier
                            .weight(1f)
                            .padding(top = if (lane > 0) 12.dp else 0.dp),
                    )
                }
            }
        }
        if (grid.unordered.isNotEmpty()) {
            Text(
                stringResource(R.string.tasks_flow_unordered),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            grid.unordered.forEach { step ->
                FlowStep(step, waiting = false, onOpen = onOpen, modifier = Modifier.fillMaxWidth())
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
