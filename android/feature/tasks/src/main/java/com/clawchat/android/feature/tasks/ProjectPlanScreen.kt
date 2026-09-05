package com.clawchat.android.feature.tasks

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import com.clawchat.android.core.data.model.ProjectNode
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ProjectPlanScreen(
    onBack: () -> Unit,
    onOpenTask: (String) -> Unit,
    onOpenConversation: (String, String?) -> Unit,
    onOpenRun: (String) -> Unit,
    viewModel: ProjectPlanViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var confirmRun by remember(state.project?.id) { mutableStateOf<ProjectNode?>(null) }
    var selectedId by rememberSaveable(state.project?.id) { mutableStateOf<String?>(null) }
    var collapsed by rememberSaveable(state.project?.id) { mutableStateOf(emptyList<String>()) }
    var showFinished by rememberSaveable(state.project?.id) { mutableStateOf(false) }
    val selected = state.nodes.firstOrNull { it.id == selectedId }
    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            viewModel.refresh()
            while (isActive) { delay(10_000); viewModel.refresh() }
        }
    }
    LaunchedEffect(state.openConversation, state.openRun) {
        val conversation = state.openConversation
        val run = state.openRun
        val title = state.conversationTitle
        viewModel.navigationConsumed()
        if (conversation != null) onOpenConversation(conversation, title)
        else if (run != null) onOpenRun(run)
    }
    val back = { if (state.project != null) viewModel.select(null) else onBack() }
    BackHandler { if (!state.busy) back() }
    Scaffold(topBar = {
        TopAppBar(title = { Text(state.project?.title ?: stringResource(R.string.projects_title)) },
            navigationIcon = { TextButton(onClick = back, enabled = !state.busy) { Text(stringResource(R.string.projects_back)) } },
            actions = { TextButton(onClick = viewModel::refresh, enabled = !state.loading && !state.busy) { Text(stringResource(R.string.projects_refresh)) } })
    }, bottomBar = {
        selected?.let { node ->
            Surface(tonalElevation = 3.dp) {
                Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(12.dp)) {
                    Row {
                        Text(node.title, modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                        TextButton(onClick = { selectedId = null }) { Text(stringResource(R.string.projects_close_selection)) }
                    }
                    if (node.blockers.isNotEmpty()) Text(stringResource(R.string.projects_dependencies,
                        node.blockers.joinToString(", ") { state.taskTitles[it] ?: it }))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (node.isReady) Button(onClick = { confirmRun = node }, enabled = !state.busy && !state.loading) {
                            Text(stringResource(R.string.projects_run))
                        }
                        TextButton(onClick = { onOpenTask(node.id) }, enabled = !state.busy) { Text(stringResource(R.string.projects_task)) }
                        TextButton(onClick = { viewModel.discuss(node.id) }, enabled = !state.busy) { Text(stringResource(R.string.projects_discuss)) }
                    }
                }
            }
        }
    }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (state.loading) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
            state.error?.let { error -> item { Text(error, color = MaterialTheme.colorScheme.error) } }
            val project = state.project
            if (project == null) {
                if (!state.loading && state.projects.isEmpty()) item { Text(stringResource(R.string.projects_empty)) }
                items(state.projects, key = { it.id }) { entry ->
                    Card(Modifier.fillMaxWidth().clickable { viewModel.select(entry) }) {
                        Column(Modifier.padding(16.dp)) {
                            Text(entry.title, style = MaterialTheme.typography.titleMedium)
                            entry.goal?.let { Text(it) }
                        }
                    }
                }
            } else {
                item {
                    project.goal?.let { Text(it) }
                    project.hostLabel?.let { Text(stringResource(R.string.projects_machine, it,
                        stringResource(if (project.hostOnline == true) R.string.projects_online else R.string.projects_offline))) }
                    Button(onClick = { viewModel.discuss() }, enabled = !state.busy && project.rootTaskId != null) {
                        Text(stringResource(R.string.projects_agent))
                    }
                    Text("${stringResource(R.string.projects_ready)} · ${state.nodes.count { it.isReady }}", style = MaterialTheme.typography.titleMedium)
                }
                val ready = state.nodes.filter { it.isReady }
                if (!state.loading && ready.isEmpty()) item { Text(stringResource(R.string.projects_no_ready)) }
                items(ready.take(3), key = { "ready:${it.id}" }) { node ->
                    TextButton(onClick = { selectedId = node.id }, enabled = !state.busy) {
                        Text(node.title)
                    }
                }
                item {
                    Row {
                        Text(stringResource(R.string.projects_outline), modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                        TextButton(onClick = { showFinished = !showFinished }) {
                            Text(stringResource(if (showFinished) R.string.projects_hide_finished else R.string.projects_show_finished))
                        }
                    }
                }
                items(visibleProjectOutline(state.nodes, collapsed.toSet(), showFinished), key = { "outline:${it.first.id}" }) { (node, depth) ->
                    Column(Modifier.fillMaxWidth().clickable { selectedId = node.id }.padding(start = (depth.coerceAtMost(5) * 12).dp, top = 8.dp, bottom = 8.dp)) {
                        Row {
                            Text(node.title, modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleSmall,
                                color = if (selectedId == node.id) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
                            if (state.nodes.any { it.parentId == node.id }) TextButton(onClick = {
                                collapsed = if (node.id in collapsed) collapsed - node.id else collapsed + node.id
                            }) { Text(stringResource(if (node.id in collapsed) R.string.projects_expand else R.string.projects_collapse)) }
                        }
                        Text(stringResource(when (node.executionState) {
                            "ready" -> R.string.projects_ready
                            "blocked" -> R.string.projects_blocked
                            "in_progress" -> R.string.projects_running
                            "completed" -> R.string.projects_done
                            "cancelled" -> R.string.projects_cancelled
                            else -> R.string.projects_pending
                        }))
                        HorizontalDivider()
                    }
                }
            }
        }
    }
    confirmRun?.let { node ->
        AlertDialog(onDismissRequest = { confirmRun = null },
            title = { Text(stringResource(R.string.projects_run)) },
            text = { Text(stringResource(R.string.projects_run_confirm, node.title)) },
            confirmButton = { TextButton(onClick = { confirmRun = null; viewModel.run(node.id) }, enabled = !state.busy && !state.loading) { Text(stringResource(R.string.projects_run)) } },
            dismissButton = { TextButton(onClick = { confirmRun = null }) { Text(stringResource(R.string.projects_back)) } })
    }
}
