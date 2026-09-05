package com.clawchat.android.feature.progress

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.clawchat.android.core.data.model.AgentRun
import com.clawchat.android.core.data.model.AgentRunStatus
import com.clawchat.android.core.data.model.ReviewRiskLevel
import com.clawchat.android.core.data.model.TaskComment
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.QuickCaptureParser
import com.clawchat.android.core.ui.ClawEmptyState
import com.clawchat.android.core.ui.ClawListItemSurface
import com.clawchat.android.core.ui.ClawSectionCard
import com.clawchat.android.core.ui.ClawSectionHeader
import com.clawchat.android.core.ui.ClawStatusChip
import com.clawchat.android.core.ui.ClawTone
import com.clawchat.android.core.ui.ClawTopBarColors
import com.clawchat.android.core.ui.localizedErrorMessage
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.delay

private const val ACTIVE_POLL_INTERVAL_MS = 3_000L

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProgressScreen(
    onOpenSearch: () -> Unit = {},
    onOpenSettings: () -> Unit = {},
    onOpenReview: (String) -> Unit = {},
    onOpenRun: (String) -> Unit = {},
    onOpenTask: (String) -> Unit = {},
    viewModel: ProgressViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var selectedAction by remember { mutableStateOf<NowItem?>(null) }
    var captureText by remember { mutableStateOf("") }
    val snackbarHostState = remember { SnackbarHostState() }
    val capturedMessage = stringResource(R.string.progress_capture_saved)
    val undoLabel = stringResource(R.string.progress_capture_undo)

    LaunchedEffect(state.hasExecutingRuns) {
        if (!state.hasExecutingRuns) return@LaunchedEffect
        while (true) {
            delay(ACTIVE_POLL_INTERVAL_MS)
            viewModel.poll()
        }
    }

    LaunchedEffect(selectedAction?.stableId, state.attentionItems, state.pendingActionId) {
        val selectedId = selectedAction?.stableId ?: return@LaunchedEffect
        if (state.pendingActionId == null && state.attentionItems.none { it.stableId == selectedId }) {
            selectedAction = null
        }
    }

    LaunchedEffect(viewModel) {
        viewModel.captureEvents.collect { captured ->
            captureText = ""
            val result = snackbarHostState.showSnackbar(
                message = capturedMessage,
                actionLabel = undoLabel,
                withDismissAction = true,
                duration = SnackbarDuration.Long,
            )
            if (result == SnackbarResult.ActionPerformed) {
                viewModel.undoCapture(captured)
            }
        }
    }

    val localizedCommentError = state.commentError?.let { localizedErrorMessage(it) }
    LaunchedEffect(localizedCommentError) {
        val message = localizedCommentError ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(message)
        viewModel.clearCommentError()
    }

    val localizedWorkError = state.workError?.let { localizedErrorMessage(it) }
    LaunchedEffect(localizedWorkError) {
        val message = localizedWorkError ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(message)
        viewModel.clearWorkError()
    }

    LaunchedEffect(viewModel) {
        viewModel.startEvents.collect { captureText = "" }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                navigationIcon = { com.clawchat.android.core.ui.NavigationMenuButton() },
                title = {
                    Text(
                        text = stringResource(R.string.progress_title),
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold,
                    )
                },
                actions = {
                    IconButton(onClick = onOpenSearch) {
                        Icon(
                            Icons.Default.Search,
                            contentDescription = stringResource(R.string.progress_search),
                        )
                    }
                    IconButton(onClick = onOpenSettings) {
                        Icon(
                            Icons.Default.Settings,
                            contentDescription = stringResource(R.string.progress_settings),
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
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            when {
                state.isLoading && !state.hasAnyContent -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator()
                }

                else -> ProgressContent(
                    state = state,
                    onOpenReview = onOpenReview,
                    onOpenRun = onOpenRun,
                    onOpenTask = onOpenTask,
                    onSelectAction = { item ->
                        viewModel.clearActionError()
                        selectedAction = item
                    },
                    onRetryPending = viewModel::retryPending,
                    captureText = captureText,
                    onCaptureTextChange = { captureText = it },
                    onCapture = { viewModel.captureToInbox(captureText) },
                    onStartNow = { viewModel.startTaskNow(captureText) },
                    onSubmitComment = viewModel::addComment,
                    onCompleteTask = viewModel::completeTask,
                    onPauseTask = viewModel::pauseTask,
                    onAddStep = viewModel::addStep,
                    onToggleStep = viewModel::setStepDone,
                    onRemoveStep = viewModel::removeStep,
                    onCancelRun = viewModel::cancelRun,
                )
            }
        }
    }

    selectedAction?.let { item ->
        NowActionSheet(
            item = item,
            isPending = state.pendingActionId == item.stableId,
            error = state.actionError,
            onDismiss = {
                if (state.pendingActionId == null) {
                    viewModel.clearActionError()
                    selectedAction = null
                }
            },
            onFile = { dueToday -> viewModel.fileTodo(item, dueToday) },
            onRetry = { viewModel.retryNowItem(item) },
            onAnswerRun = { answer -> viewModel.answerRun(item, answer) },
            onAnswerTodo = { answers -> viewModel.answerTodoQuestions(item, answers) },
            onSkipTodoQuestions = { viewModel.skipTodoQuestions(item) },
        )
    }
}

@Composable
private fun ProgressContent(
    state: ProgressUiState,
    onOpenReview: (String) -> Unit,
    onOpenRun: (String) -> Unit,
    onOpenTask: (String) -> Unit,
    onSelectAction: (NowItem) -> Unit,
    onRetryPending: () -> Unit,
    captureText: String,
    onCaptureTextChange: (String) -> Unit,
    onCapture: () -> Unit,
    onStartNow: () -> Unit,
    onSubmitComment: (todoId: String, text: String) -> Unit,
    onCompleteTask: (todoId: String) -> Unit,
    onPauseTask: (todoId: String) -> Unit,
    onAddStep: (parentId: String, title: String) -> Unit,
    onToggleStep: (stepId: String, done: Boolean) -> Unit,
    onRemoveStep: (stepId: String) -> Unit,
    onCancelRun: (runId: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 4.dp, bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item(key = "connection") {
            ProgressConnectionCard(state)
        }

        item(key = "capture") {
            QuickCaptureCard(
                text = captureText,
                isSubmitting = state.isCapturing,
                error = state.captureError,
                onTextChange = onCaptureTextChange,
                onSubmit = onCapture,
                onStartNow = onStartNow,
            )
        }

        state.errors.firstOrNull()?.let { error ->
            item(key = "error") {
                ClawStatusChip(
                    text = localizedErrorMessage(error),
                    tone = ClawTone.Error,
                )
            }
        }

        if (state.hasPendingSyncFailure) {
            item(key = "sync_delayed") {
                ClawSectionCard(tone = ClawTone.Warning) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(2.dp),
                        ) {
                            Text(
                                text = stringResource(R.string.progress_sync_delayed_title),
                                style = MaterialTheme.typography.bodyLarge,
                                fontWeight = FontWeight.Medium,
                            )
                            Text(
                                text = stringResource(R.string.progress_sync_delayed_description),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        TextButton(
                            enabled = !state.isRetryingPendingSync,
                            onClick = onRetryPending,
                        ) {
                            Text(
                                stringResource(
                                    if (state.isRetryingPendingSync) {
                                        R.string.progress_sync_retrying
                                    } else {
                                        R.string.progress_sync_retry
                                    },
                                ),
                            )
                        }
                    }
                    if (state.isRetryingPendingSync) {
                        LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                    }
                }
            }
        }

        if (!state.hasAnyContent && state.errors.isEmpty()) {
            item(key = "empty") {
                ClawEmptyState(
                    title = stringResource(R.string.progress_empty_title),
                    description = stringResource(R.string.progress_empty_description),
                )
            }
        }

        if (state.attentionItems.isNotEmpty()) {
            item(key = "attention_header") {
                ClawSectionHeader(
                    title = stringResource(R.string.progress_attention_title),
                    subtitle = stringResource(R.string.progress_attention_description),
                )
            }
            items(state.attentionItems, key = NowItem::stableId) { item ->
                NowAttentionRow(
                    item = item,
                    onClick = {
                        if (item.canHandleOnDevice) {
                            onSelectAction(item)
                        } else {
                            when (item.source) {
                                NowSource.TODO -> item.todoId?.let(onOpenTask)
                                NowSource.REVIEW -> onOpenReview(item.sourceId)
                                NowSource.AGENT_RUN -> onOpenRun(item.sourceId)
                            }
                        }
                    },
                )
            }
        }

        if (state.processingCount > 0) {
            item(key = "processing") {
                ClawSectionCard {
                    Text(
                        text = stringResource(R.string.progress_processing, state.processingCount),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        if (state.executingRuns.isNotEmpty() || state.inProgressTasks.isNotEmpty()) {
            item(key = "active_header") {
                ClawSectionHeader(
                    title = stringResource(R.string.progress_active_title),
                    subtitle = stringResource(R.string.progress_active_description),
                )
            }
            items(state.executingRuns, key = { "run:${it.id}" }) { run ->
                AgentRunProgressRow(
                    run = run,
                    isPending = run.id in state.pendingWorkIds,
                    onClick = { onOpenRun(run.id) },
                    onCancel = { onCancelRun(run.id) },
                )
            }
            items(state.inProgressTasks, key = { "task:${it.id}" }) { task ->
                WorkCard(
                    task = task,
                    steps = state.stepsFor(task.id),
                    comments = state.commentsByTodoId[task.id].orEmpty(),
                    pendingWorkIds = state.pendingWorkIds,
                    onOpenTask = { onOpenTask(task.id) },
                    onComplete = { onCompleteTask(task.id) },
                    onPause = { onPauseTask(task.id) },
                    onAddStep = { title -> onAddStep(task.id, title) },
                    onToggleStep = onToggleStep,
                    onRemoveStep = onRemoveStep,
                    onSubmitComment = { text -> onSubmitComment(task.id, text) },
                )
            }
        }
    }
}

@Composable
private fun QuickCaptureCard(
    text: String,
    isSubmitting: Boolean,
    error: String?,
    onTextChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onStartNow: () -> Unit,
) {
    val parsed = remember(text) { QuickCaptureParser.parse(text) }
    ClawSectionCard(tone = ClawTone.Primary) {
        Text(
            text = stringResource(R.string.progress_capture_title),
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
        )
        OutlinedTextField(
            value = text,
            onValueChange = { if (!isSubmitting) onTextChange(it) },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text(stringResource(R.string.progress_capture_hint)) },
            singleLine = true,
            enabled = !isSubmitting,
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.Sentences,
                imeAction = ImeAction.Done,
            ),
            keyboardActions = KeyboardActions(onDone = { if (parsed != null) onSubmit() }),
            trailingIcon = {
                IconButton(
                    onClick = onSubmit,
                    enabled = parsed != null && !isSubmitting,
                ) {
                    if (isSubmitting) {
                        CircularProgressIndicator(modifier = Modifier.padding(8.dp))
                    } else {
                        Icon(
                            Icons.Default.Add,
                            contentDescription = stringResource(R.string.progress_capture_add),
                        )
                    }
                }
            },
        )
        parsed?.let { draft ->
            val metadata = draft.tags.map { "#$it" }
            if (metadata.isNotEmpty()) {
                Text(
                    text = metadata.joinToString(" · "),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }
        error?.let {
            ClawStatusChip(text = localizedErrorMessage(it), tone = ClawTone.Error)
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = stringResource(R.string.progress_capture_description),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
            // Capture is for later; this is for the thing you are doing right now.
            TextButton(
                onClick = onStartNow,
                enabled = parsed != null && !isSubmitting,
            ) {
                Icon(Icons.Default.PlayArrow, contentDescription = null)
                Text(stringResource(R.string.progress_start_now))
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NowActionSheet(
    item: NowItem,
    isPending: Boolean,
    error: String?,
    onDismiss: () -> Unit,
    onFile: (dueToday: Boolean) -> Unit,
    onRetry: () -> Unit,
    onAnswerRun: (String) -> Unit,
    onAnswerTodo: (Map<String, String>) -> Unit,
    onSkipTodoQuestions: () -> Unit,
) {
    var runAnswer by remember(item.stableId) { mutableStateOf("") }
    var todoAnswers by remember(item.stableId) {
        mutableStateOf(List(item.questions.size) { "" })
    }
    val isTodoQuestion = item.source == NowSource.TODO && item.action == NowAction.ANSWER
    val title = when (item.action) {
        NowAction.ANSWER -> stringResource(R.string.progress_answer_title)
        NowAction.RETRY -> stringResource(R.string.progress_retry_title)
        NowAction.FILE -> stringResource(R.string.progress_file_title)
        NowAction.APPROVE -> stringResource(R.string.progress_action_approve)
    }
    val sheetState = rememberModalBottomSheetState(
        skipPartiallyExpanded = true,
        confirmValueChange = { !isPending },
    )

    ModalBottomSheet(
        onDismissRequest = { if (!isPending) onDismiss() },
        sheetState = sheetState,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = item.title,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium,
            )
            item.summary?.takeIf(String::isNotBlank)?.let { summary ->
                Text(
                    text = summary,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (isTodoQuestion) {
                item.questions.forEachIndexed { answerIndex, question ->
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            text = stringResource(
                                R.string.progress_question_number,
                                answerIndex + 1,
                                question.text,
                            ),
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Medium,
                        )
                        OutlinedTextField(
                            value = todoAnswers[answerIndex],
                            onValueChange = { value ->
                                todoAnswers = todoAnswers.toMutableList().also {
                                    it[answerIndex] = value
                                }
                            },
                            modifier = Modifier.fillMaxWidth(),
                            enabled = !isPending,
                            minLines = 2,
                            maxLines = 4,
                            label = { Text(stringResource(R.string.progress_answer_label)) },
                        )
                    }
                }
            } else if (item.action == NowAction.ANSWER) {
                OutlinedTextField(
                    value = runAnswer,
                    onValueChange = { runAnswer = it },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !isPending,
                    minLines = 3,
                    maxLines = 6,
                    label = { Text(stringResource(R.string.progress_answer_label)) },
                )
            }
            error?.let {
                Text(
                    text = localizedErrorMessage(it),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
            if (isPending) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())

            Button(
                modifier = Modifier.fillMaxWidth(),
                enabled = !isPending && when {
                    isTodoQuestion -> todoAnswers.isNotEmpty() && todoAnswers.all(String::isNotBlank)
                    item.action == NowAction.ANSWER -> runAnswer.isNotBlank()
                    else -> true
                },
                onClick = {
                    when (item.action) {
                        NowAction.ANSWER -> if (isTodoQuestion) {
                            onAnswerTodo(answersByOriginalIndex(item.questions, todoAnswers))
                        } else {
                            onAnswerRun(runAnswer)
                        }
                        NowAction.RETRY -> onRetry()
                        NowAction.FILE -> onFile(false)
                        NowAction.APPROVE -> Unit
                    }
                },
            ) {
                Text(
                    stringResource(
                        when (item.action) {
                            NowAction.ANSWER -> R.string.progress_answer_resume
                            NowAction.RETRY -> R.string.progress_action_retry
                            NowAction.FILE -> R.string.progress_file_tasks
                            NowAction.APPROVE -> R.string.progress_action_approve
                        },
                    ),
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
            ) {
                if (isTodoQuestion) {
                    TextButton(enabled = !isPending, onClick = onSkipTodoQuestions) {
                        Text(stringResource(R.string.progress_questions_skip))
                    }
                }
                if (item.action == NowAction.FILE) {
                    TextButton(enabled = !isPending, onClick = { onFile(true) }) {
                        Text(stringResource(R.string.progress_file_today))
                    }
                }
                TextButton(enabled = !isPending, onClick = onDismiss) {
                    Text(stringResource(R.string.progress_action_cancel))
                }
            }
        }
    }
}

@Composable
private fun ProgressConnectionCard(state: ProgressUiState) {
    ClawSectionCard(tone = if (state.isConnected) ClawTone.Success else ClawTone.Warning) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    text = pluralStringResource(
                        R.plurals.progress_summary,
                        state.attentionCount,
                        state.attentionCount,
                    ),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = stringResource(
                        if (state.isConnected) R.string.progress_realtime_connected
                        else R.string.progress_realtime_reconnecting,
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (state.pendingSyncCount > 0) {
                ClawStatusChip(
                    text = stringResource(R.string.progress_sync_pending, state.pendingSyncCount),
                    tone = ClawTone.Warning,
                )
            } else {
                ClawStatusChip(
                    text = stringResource(
                        if (state.isConnected) R.string.progress_synced
                        else R.string.progress_no_pending,
                    ),
                    tone = if (state.isConnected) ClawTone.Success else ClawTone.Default,
                )
            }
        }
        if (state.isRefreshing) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun NowAttentionRow(item: NowItem, onClick: () -> Unit) {
    ClawListItemSurface(onClick = onClick) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    text = item.title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                item.summary?.takeIf(String::isNotBlank)?.let { summary ->
                    Text(
                        text = summary,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            ClawStatusChip(
                text = nowActionLabel(item.action),
                tone = nowActionTone(item),
            )
        }
    }
}

@Composable
private fun nowActionLabel(action: NowAction): String = stringResource(
    when (action) {
        NowAction.ANSWER -> R.string.progress_action_answer
        NowAction.APPROVE -> R.string.progress_action_approve
        NowAction.FILE -> R.string.progress_action_file
        NowAction.RETRY -> R.string.progress_action_retry
    },
)

private fun nowActionTone(item: NowItem): ClawTone = when (item.action) {
    NowAction.ANSWER -> ClawTone.Warning
    NowAction.APPROVE -> when (item.riskLevel) {
        ReviewRiskLevel.HIGH -> ClawTone.Error
        ReviewRiskLevel.MEDIUM -> ClawTone.Warning
        ReviewRiskLevel.LOW, null -> ClawTone.Primary
    }
    NowAction.FILE -> ClawTone.Default
    NowAction.RETRY -> ClawTone.Error
}

@Composable
private fun AgentRunProgressRow(
    run: AgentRun,
    isPending: Boolean,
    onClick: () -> Unit,
    onCancel: () -> Unit,
) {
    ClawListItemSurface(onClick = onClick) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = run.displayTitle,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = listOfNotNull(
                        run.hostLabel?.takeIf(String::isNotBlank),
                        run.progressMessage?.takeIf(String::isNotBlank)
                            ?: agentRunStatusLabel(run.status),
                    ).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (run.status.isExecuting) {
                    LinearProgressIndicator(
                        progress = { run.progress.coerceIn(0, 100) / 100f },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            ClawStatusChip(
                text = agentRunStatusLabel(run.status),
                tone = agentRunTone(run.status),
            )
        }
        if (run.canCancel) {
            TextButton(onClick = onCancel, enabled = !isPending) {
                Text(stringResource(R.string.progress_run_cancel))
            }
        }
    }
}

/**
 * One piece of work in progress, with everything you do to it while working:
 * tick off or add steps, leave a note, finish it, or set it aside.
 *
 * "In progress" used to be a list of titles that opened the task page; every
 * change meant leaving this tab and coming back.
 */
@Composable
private fun WorkCard(
    task: Todo,
    steps: List<Todo>,
    comments: List<TaskComment>,
    pendingWorkIds: Set<String>,
    onOpenTask: () -> Unit,
    onComplete: () -> Unit,
    onPause: () -> Unit,
    onAddStep: (String) -> Unit,
    onToggleStep: (stepId: String, done: Boolean) -> Unit,
    onRemoveStep: (stepId: String) -> Unit,
    onSubmitComment: (String) -> Unit,
) {
    var stepDraft by remember(task.id) { mutableStateOf("") }
    var draft by remember(task.id) { mutableStateOf("") }
    val taskPending = task.id in pendingWorkIds
    val doneSteps = steps.count { it.status == TaskStatus.COMPLETED }
    ClawSectionCard {
        ClawListItemSurface(onClick = onOpenTask) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        text = task.title,
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.Medium,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    task.nextAction?.takeIf(String::isNotBlank)?.let { nextAction ->
                        Text(
                            text = nextAction,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                ClawStatusChip(
                    text = if (task.syncStatus == "pending") {
                        stringResource(R.string.progress_task_sync_pending)
                    } else if (steps.isNotEmpty()) {
                        stringResource(R.string.progress_steps_progress, doneSteps, steps.size)
                    } else {
                        stringResource(R.string.progress_task_state)
                    },
                    tone = if (task.syncStatus == "pending") ClawTone.Warning else ClawTone.Primary,
                )
            }
        }

        steps.forEach { step ->
            val done = step.status == TaskStatus.COMPLETED
            val stepPending = step.id in pendingWorkIds
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Checkbox(
                    checked = done,
                    enabled = !stepPending,
                    onCheckedChange = { checked -> onToggleStep(step.id, checked) },
                )
                Text(
                    text = step.title,
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.bodyMedium,
                    textDecoration = if (done) TextDecoration.LineThrough else null,
                    color = if (done) {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    } else {
                        MaterialTheme.colorScheme.onSurface
                    },
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                IconButton(onClick = { onRemoveStep(step.id) }, enabled = !stepPending) {
                    Icon(
                        Icons.Default.Close,
                        contentDescription = stringResource(R.string.progress_step_remove),
                    )
                }
            }
        }
        OutlinedTextField(
            value = stepDraft,
            onValueChange = { stepDraft = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text(stringResource(R.string.progress_step_hint)) },
            singleLine = true,
            enabled = !taskPending,
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.Sentences,
                imeAction = ImeAction.Done,
            ),
            keyboardActions = KeyboardActions(
                onDone = {
                    if (stepDraft.isNotBlank()) {
                        onAddStep(stepDraft)
                        stepDraft = ""
                    }
                },
            ),
            trailingIcon = {
                IconButton(
                    onClick = {
                        if (stepDraft.isNotBlank()) {
                            onAddStep(stepDraft)
                            stepDraft = ""
                        }
                    },
                    enabled = stepDraft.isNotBlank() && !taskPending,
                ) {
                    Icon(
                        Icons.Default.Add,
                        contentDescription = stringResource(R.string.progress_step_add),
                    )
                }
            },
        )

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = onComplete, enabled = !taskPending) {
                Icon(Icons.Default.Check, contentDescription = null)
                Text(stringResource(R.string.progress_work_done))
            }
            TextButton(onClick = onPause, enabled = !taskPending) {
                Text(stringResource(R.string.progress_work_pause))
            }
        }

        Text(
            text = stringResource(R.string.progress_threads_title),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (comments.isEmpty()) {
            Text(
                text = stringResource(R.string.progress_threads_empty),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                comments.forEach { comment -> CommentBubbleRow(comment) }
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = draft,
                onValueChange = { draft = it },
                modifier = Modifier.weight(1f),
                placeholder = { Text(stringResource(R.string.progress_threads_hint)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Sentences,
                    imeAction = ImeAction.Send,
                ),
                keyboardActions = KeyboardActions(
                    onSend = {
                        if (draft.isNotBlank()) {
                            onSubmitComment(draft)
                            draft = ""
                        }
                    },
                ),
            )
            IconButton(
                onClick = {
                    if (draft.isNotBlank()) {
                        onSubmitComment(draft)
                        draft = ""
                    }
                },
                enabled = draft.isNotBlank(),
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.Send,
                    contentDescription = stringResource(R.string.progress_threads_send),
                )
            }
        }
    }
}

@Composable
private fun CommentBubbleRow(comment: TaskComment) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = formatCommentTime(comment.createdAt),
            modifier = Modifier.width(88.dp),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = comment.content,
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}

private fun formatCommentTime(value: String): String {
    val zoned = runCatching {
        OffsetDateTime.parse(value).atZoneSameInstant(ZoneId.systemDefault())
    }.recoverCatching {
        LocalDateTime.parse(value).atZone(ZoneId.systemDefault())
    }.getOrNull()
    val formatter = DateTimeFormatter.ofPattern("MMM d · h:mm a", Locale.getDefault())
    return zoned?.format(formatter) ?: value
}

@Composable
private fun agentRunStatusLabel(status: AgentRunStatus): String = stringResource(
    when (status) {
        AgentRunStatus.QUEUED -> R.string.progress_run_queued
        AgentRunStatus.STARTING -> R.string.progress_run_starting
        AgentRunStatus.RUNNING -> R.string.progress_run_running
        AgentRunStatus.WAITING_INPUT -> R.string.progress_run_waiting_input
        AgentRunStatus.WAITING_REVIEW -> R.string.progress_run_waiting_review
        AgentRunStatus.COMPLETED -> R.string.progress_run_completed
        AgentRunStatus.FAILED -> R.string.progress_run_failed
        AgentRunStatus.CANCELLED -> R.string.progress_run_cancelled
    },
)

private fun agentRunTone(status: AgentRunStatus): ClawTone = when (status) {
    AgentRunStatus.QUEUED, AgentRunStatus.STARTING, AgentRunStatus.RUNNING -> ClawTone.Primary
    AgentRunStatus.WAITING_INPUT, AgentRunStatus.WAITING_REVIEW -> ClawTone.Warning
    AgentRunStatus.COMPLETED -> ClawTone.Success
    AgentRunStatus.FAILED -> ClawTone.Error
    AgentRunStatus.CANCELLED -> ClawTone.Default
}
