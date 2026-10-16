package com.clawchat.android.feature.inbox

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.clawchat.android.core.ui.ClawLoadingState
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
    BackHandler(enabled = state.selection.isNotEmpty()) {
        viewModel.onAction(InboxAction.ClearSelection)
    }
    val snackbar = remember { SnackbarHostState() }
    val undoLabel = stringResource(R.string.inbox_undo)
    val movedMessage = state.lastMove?.let { inboxMoveMessage(it) }
    LaunchedEffect(state.lastMove?.token) {
        val move = state.lastMove ?: return@LaunchedEffect
        val result = snackbar.showSnackbar(
            message = movedMessage.orEmpty(),
            actionLabel = undoLabel,
            withDismissAction = true,
            duration = SnackbarDuration.Long,
        )
        viewModel.onAction(
            if (result == SnackbarResult.ActionPerformed) InboxAction.UndoMove(move.token)
            else InboxAction.MoveDismissed(move.token),
        )
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
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
        PullToRefreshBox(
            isRefreshing = state.isRefreshing,
            onRefresh = viewModel::refresh,
            modifier = Modifier.fillMaxSize().padding(padding),
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

    // Notes have no list of their own on the phone; a filed note opens them here.
    if (showNotes) {
        ModalBottomSheet(
            onDismissRequest = { showNotes = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        ) {
            Box(Modifier.fillMaxSize()) { InboxNotesPanel() }
        }
    }
}

@Composable
private fun inboxMoveMessage(move: InboxMove): String = when (move.kind) {
    InboxMoveKind.TASK -> if (move.count == 1) stringResource(R.string.inbox_moved_to_task)
        else pluralStringResource(R.plurals.inbox_moved_many_to_task, move.count, move.count)
    InboxMoveKind.NOTE -> if (move.count == 1) stringResource(R.string.inbox_moved_to_note)
        else pluralStringResource(R.plurals.inbox_moved_many_to_note, move.count, move.count)
    InboxMoveKind.PROJECT -> stringResource(R.string.inbox_moved_to_project)
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
