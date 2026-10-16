package com.clawchat.android.feature.inbox

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.clawchat.android.core.ui.ClawCrossfade
import com.clawchat.android.core.ui.ClawLoadingState
import com.clawchat.android.core.ui.ClawSegmentedToggle
import com.clawchat.android.core.ui.ClawTopBarColors
import com.clawchat.android.core.ui.localizedErrorMessage

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InboxScreen(
    viewModel: InboxViewModel = hiltViewModel(),
    onTaskClick: (String) -> Unit = {},
    onBack: () -> Unit = {},
    captureViewModel: InboxCaptureViewModel = hiltViewModel(),
) {
    var showNotes by rememberSaveable { mutableStateOf(false) }
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val capture by captureViewModel.uiState.collectAsStateWithLifecycle()
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(capture.captureSaved) {
        if (capture.captureSaved) keyboard?.hide()
    }
    BackHandler(enabled = !showNotes && state.selection.isNotEmpty()) {
        viewModel.onAction(InboxAction.ClearSelection)
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        bottomBar = {
            if (!showNotes) {
                com.clawchat.android.core.ui.ClawComposer(
                    value = capture.captureText,
                    onValueChange = captureViewModel::editCapture,
                    placeholder = stringResource(R.string.inbox_capture_label),
                    enabled = !capture.capturing,
                    actionEnabled = capture.captureText.isNotBlank() && !capture.capturing,
                    actionIcon = Icons.AutoMirrored.Filled.Send,
                    actionLabel = stringResource(if (capture.capturing) R.string.inbox_capture_saving else R.string.inbox_capture_add),
                    onAction = captureViewModel::capture,
                ) {
                    capture.error?.let { Text(localizedErrorMessage(it)) }
                    if (capture.captureSaved) Text(stringResource(
                        if (capture.server) R.string.inbox_capture_saved_server else R.string.inbox_capture_saved),
                        style = MaterialTheme.typography.bodySmall)
                }
            }
        },
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = stringResource(R.string.inbox_title),
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold,
                    )
                },
                navigationIcon = {
                    if (com.clawchat.android.core.ui.LocalOpenNavigationMenu.current != null) {
                        com.clawchat.android.core.ui.NavigationMenuButton()
                    } else IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.inbox_back),
                        )
                    }
                },
                colors = ClawTopBarColors(),
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            ClawSegmentedToggle(
                options = listOf(stringResource(R.string.inbox_tasks_tab), stringResource(R.string.inbox_notes_tab)),
                selectedIndex = if (showNotes) 1 else 0,
                onSelect = { showNotes = it == 1 },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
            )
            ClawCrossfade(
                targetState = showNotes,
                modifier = Modifier.weight(1f),
                forward = { _, notes -> notes },
                label = "inbox",
            ) { notes ->
                if (notes) {
                    Box(Modifier.fillMaxSize()) { InboxNotesPanel() }
                } else PullToRefreshBox(
                    isRefreshing = state.isRefreshing,
                    onRefresh = viewModel::refresh,
                    modifier = Modifier.fillMaxSize(),
                ) {
                    if (state.isLoading) {
                        ClawLoadingState(message = stringResource(R.string.inbox_loading))
                    } else {
                        InboxLists(
                            state = state,
                            onAction = viewModel::onAction,
                            onOpenTask = onTaskClick,
                            onOpenNotes = { showNotes = true },
                        )
                    }

                    state.error?.let { error ->
                        Snackbar(
                            modifier = Modifier
                                .padding(12.dp)
                                .align(Alignment.BottomCenter),
                        ) {
                            Text(localizedErrorMessage(error))
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun InboxDeleteDialog(heading: String, body: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(heading) },
        text = { Text(body, maxLines = 3, overflow = TextOverflow.Ellipsis) },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text(stringResource(R.string.inbox_delete), color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.inbox_note_cancel)) }
        },
    )
}
