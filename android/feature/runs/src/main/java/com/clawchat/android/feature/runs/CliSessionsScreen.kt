package com.clawchat.android.feature.runs

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
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
import kotlinx.coroutines.delay

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CliSessionsScreen(modifier: Modifier = Modifier, viewModel: CliSessionsViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    var showSaved by rememberSaveable { mutableStateOf(false) }
    var search by rememberSaveable { mutableStateOf("") }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) { viewModel.refresh(); delay(5_000) }
        }
    }
    LazyColumn(modifier = modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Text(stringResource(R.string.cli_sessions_host), style = MaterialTheme.typography.bodySmall) }
        item {
            OutlinedTextField(value = search, onValueChange = { search = it }, modifier = Modifier.fillMaxWidth(),
                label = { Text(stringResource(R.string.cli_sessions_search)) }, singleLine = true)
            Row {
                FilterChip(selected = showSaved, onClick = { showSaved = !showSaved }, label = { Text(stringResource(R.string.cli_sessions_saved)) })
                TextButton(onClick = viewModel::refresh) { Text(stringResource(R.string.runs_refresh)) }
            }
        }
        if (state.loading) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth()) }
        if (state.error) item { Text(stringResource(R.string.cli_sessions_error), color = MaterialTheme.colorScheme.error) }
        state.listing?.providers?.filter { !it.connected }?.forEach { provider ->
            item(key = "provider:${provider.provider}") { Text(stringResource(R.string.cli_sessions_disconnected, provider.provider)) }
        }
        val rows = state.listing?.sessions.orEmpty().filter {
            (showSaved || it.kind != "history") && "${it.title} ${it.cwd} ${it.provider}".contains(search, ignoreCase = true)
        }
        if (rows.isEmpty() && !state.loading && !state.error) item { Text(stringResource(R.string.cli_sessions_empty)) }
        items(rows, key = { it.key }) { session ->
            OutlinedCard(modifier = Modifier.fillMaxWidth().clickable { viewModel.select(session) }) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("${session.provider} · ${stringResource(cliStatusLabel(session.status))}", style = MaterialTheme.typography.labelMedium)
                    Text(session.title, style = MaterialTheme.typography.titleMedium)
                    Text(session.cwd, style = MaterialTheme.typography.bodySmall)
                    session.waitingFor?.let { Text(it) }
                }
            }
        }
    }
    state.selected?.let { selected ->
        val session = state.detail?.session ?: state.listing?.sessions?.find { it.key == selected.key } ?: selected
        var message by remember(selected.key) { mutableStateOf("") }
        LaunchedEffect(state.accepted) { if (state.accepted) message = "" }
        ModalBottomSheet(onDismissRequest = { viewModel.select(null) }) {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(session.title, style = MaterialTheme.typography.titleLarge)
                if (state.detailLoading) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                if (state.error) Text(stringResource(R.string.cli_sessions_error), color = MaterialTheme.colorScheme.error)
                if (state.accepted) Text(stringResource(R.string.cli_sessions_accepted))
                state.detail?.output?.takeIf { it.isNotBlank() }?.let { output ->
                    SelectionContainer { Text(output, style = MaterialTheme.typography.bodySmall) }
                }
                if (session.provider == "claude" && session.kind == "interactive") Text(stringResource(R.string.cli_sessions_foreground))
                if (session.canSend) {
                    OutlinedTextField(value = message, onValueChange = { message = it.take(10_000) },
                        modifier = Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.cli_sessions_message)) })
                    Button(enabled = !state.busy && message.isNotBlank(), onClick = { viewModel.act(session, "message", message.trim()) }) {
                        Text(stringResource(R.string.cli_sessions_send))
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (session.canStop) OutlinedButton(enabled = !state.busy, onClick = { viewModel.act(session, "stop") }) { Text(stringResource(R.string.cli_sessions_stop)) }
                    if (session.canRestart) OutlinedButton(enabled = !state.busy, onClick = { viewModel.act(session, "restart") }) { Text(stringResource(R.string.cli_sessions_restart)) }
                    TextButton(onClick = { viewModel.select(session) }) { Text(stringResource(R.string.runs_refresh)) }
                }
                session.resumeCommand?.let { command -> SelectionContainer { Text(command) } }
                Spacer(Modifier.navigationBarsPadding())
            }
        }
    }
}

private fun cliStatusLabel(status: String): Int = when (status) {
    "running" -> R.string.cli_status_running
    "waiting_input" -> R.string.cli_status_waiting
    "idle" -> R.string.cli_status_idle
    "completed" -> R.string.cli_status_completed
    "failed" -> R.string.cli_status_failed
    "stopped" -> R.string.cli_status_stopped
    else -> R.string.cli_status_unknown
}
