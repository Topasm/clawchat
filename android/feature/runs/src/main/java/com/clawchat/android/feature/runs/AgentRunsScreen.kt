package com.clawchat.android.feature.runs

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SheetValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.clawchat.android.core.data.model.AgentRun
import com.clawchat.android.core.data.model.AgentRunEvent
import com.clawchat.android.core.data.model.AgentRunStatus
import com.clawchat.android.core.ui.ClawEmptyState
import com.clawchat.android.core.ui.ClawListItemSurface
import com.clawchat.android.core.ui.ClawMetricPill
import com.clawchat.android.core.ui.ClawSectionCard
import com.clawchat.android.core.ui.ClawSectionHeader
import com.clawchat.android.core.ui.ClawStatusChip
import com.clawchat.android.core.ui.ClawTone
import com.clawchat.android.core.ui.ClawTopBarColors
import com.clawchat.android.core.ui.localizedErrorMessage
import kotlinx.coroutines.delay
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private const val ACTIVE_POLL_INTERVAL_MS = 3_000L

/**
 * Mobile control plane for agent execution.
 *
 * Navigation stays owned by the app module: wire this screen to any route and
 * use [onOpenReview] to hand a waiting run to the Review Inbox.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgentRunsScreen(
    viewModel: AgentRunsViewModel = hiltViewModel(),
    onBack: (() -> Unit)? = null,
    onOpenReview: (AgentRun) -> Unit = {},
    /** Exact review subject to reveal after navigation; consumed once. */
    initialRunId: String? = null,
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val errorMessage = state.error?.let { localizedErrorMessage(it) }
        ?: state.errorResource?.let { stringResource(it) }
    val noticeMessage = state.notice ?: state.noticeResource?.let { stringResource(it) }

    // Do not wait for the compact 100-run list: an exact navigation target
    // may be older and is loaded directly through GET /api/runs/{id}.
    LaunchedEffect(initialRunId) {
        initialRunId?.let(viewModel::selectRun)
    }

    // Poll only while this destination is composed and a provider is actively
    // executing. Waiting-input and review states are stable until user action.
    LaunchedEffect(state.hasExecutingRuns) {
        if (!state.hasExecutingRuns) return@LaunchedEffect
        while (true) {
            delay(ACTIVE_POLL_INTERVAL_MS)
            viewModel.poll()
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = stringResource(R.string.runs_title),
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold,
                    )
                },
                navigationIcon = {
                    if (onBack != null) {
                        IconButton(onClick = onBack) {
                            Icon(
                                Icons.AutoMirrored.Filled.ArrowBack,
                                contentDescription = stringResource(R.string.runs_back),
                            )
                        }
                    }
                },
                actions = {
                    IconButton(onClick = viewModel::refresh) {
                        Icon(
                            Icons.Default.Refresh,
                            contentDescription = stringResource(R.string.runs_refresh),
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
                state.isLoading && state.runs.isEmpty() -> RunsLoadingState()
                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(
                        start = 12.dp,
                        end = 12.dp,
                        top = 4.dp,
                        bottom = 24.dp,
                    ),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    item {
                        RunSummaryCard(state)
                    }

                    item {
                        RunFilters(
                            selected = state.filter,
                            onSelect = viewModel::setFilter,
                        )
                    }

                    errorMessage?.let { message ->
                        item {
                            ClawStatusChip(text = message, tone = ClawTone.Error)
                        }
                    }

                    noticeMessage?.let { message ->
                        item {
                            ClawStatusChip(text = message, tone = ClawTone.Success)
                        }
                    }

                    if (state.visibleRuns.isEmpty()) {
                        item {
                            ClawEmptyState(
                                title = stringResource(R.string.runs_empty_title),
                                description = stringResource(R.string.runs_empty_description),
                                actionLabel = stringResource(R.string.runs_refresh_action),
                                onActionClick = viewModel::refresh,
                            )
                        }
                    } else {
                        items(state.visibleRuns, key = AgentRun::id) { run ->
                            AgentRunListItem(
                                run = run,
                                onClick = { viewModel.selectRun(run.id) },
                            )
                        }
                    }
                }
            }
        }
    }

    state.selectedRun?.let { run ->
        AgentRunDetailSheet(
            run = run,
            events = state.events,
            followUp = state.followUp,
            isLoading = state.isDetailLoading,
            pendingOperation = if (state.pendingRunId == run.id) state.pendingOperation else null,
            error = errorMessage,
            notice = noticeMessage,
            onFollowUpChange = viewModel::updateFollowUp,
            onCancel = { viewModel.cancelRun(run.id) },
            onRetry = { viewModel.retryRun(run.id) },
            onResume = { viewModel.resumeRun(run.id) },
            onOpenReview = { onOpenReview(run) },
            onDismiss = viewModel::closeDetails,
        )
    }
}

@Composable
private fun RunsLoadingState() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            CircularProgressIndicator(modifier = Modifier.size(28.dp))
            Text(
                text = stringResource(R.string.runs_loading),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun RunSummaryCard(state: AgentRunsUiState) {
    ClawSectionCard(tone = if (state.attentionCount > 0) ClawTone.Warning else ClawTone.Primary) {
        ClawSectionHeader(
            title = stringResource(R.string.runs_overview_title),
            subtitle = if (state.attentionCount > 0) {
                pluralStringResource(
                    R.plurals.runs_attention_summary,
                    state.attentionCount,
                    state.attentionCount,
                )
            } else {
                stringResource(R.string.runs_unblocked_summary)
            },
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ClawMetricPill(
                label = stringResource(R.string.runs_metric_active),
                value = state.activeCount.toString(),
                modifier = Modifier.weight(1f),
            )
            ClawMetricPill(
                label = stringResource(R.string.runs_metric_attention),
                value = state.attentionCount.toString(),
                modifier = Modifier.weight(1f),
            )
            ClawMetricPill(
                label = stringResource(R.string.runs_metric_failed),
                value = state.failedCount.toString(),
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun RunFilters(
    selected: AgentRunFilter,
    onSelect: (AgentRunFilter) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        AgentRunFilter.entries.forEach { filter ->
            FilterChip(
                selected = selected == filter,
                onClick = { onSelect(filter) },
                label = { Text(filter.localizedLabel()) },
            )
        }
    }
}

@Composable
private fun AgentRunListItem(
    run: AgentRun,
    onClick: () -> Unit,
) {
    ClawListItemSurface(onClick = onClick) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ClawStatusChip(
                text = run.status.localizedLabel(),
                tone = run.status.tone(),
            )
            Text(
                text = stringResource(R.string.runs_attempt, run.attempt),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.weight(1f))
            Text(
                text = formatRunTime(run.updatedAt),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        Text(
            text = run.localizedDisplayTitle(),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )

        val unscoped = stringResource(R.string.runs_unscoped)
        Text(
            text = buildString {
                append(run.projectTitle ?: unscoped)
                append(" · ")
                append(run.provider)
                run.model?.takeIf { it.isNotBlank() }?.let { append(" / $it") }
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )

        LinearProgressIndicator(
            progress = { run.progress.coerceIn(0, 100) / 100f },
            modifier = Modifier.fillMaxWidth(),
        )

        Row(modifier = Modifier.fillMaxWidth()) {
            Text(
                text = run.progressMessage ?: when (run.status) {
                    AgentRunStatus.WAITING_INPUT -> stringResource(R.string.runs_waiting_follow_up)
                    AgentRunStatus.WAITING_REVIEW -> stringResource(R.string.runs_ready_for_review)
                    else -> stringResource(R.string.runs_progress_complete, run.progress)
                },
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = "${run.progress}%",
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AgentRunDetailSheet(
    run: AgentRun,
    events: List<AgentRunEvent>,
    followUp: String,
    isLoading: Boolean,
    pendingOperation: AgentRunOperation?,
    error: String?,
    notice: String?,
    onFollowUpChange: (String) -> Unit,
    onCancel: () -> Unit,
    onRetry: () -> Unit,
    onResume: () -> Unit,
    onOpenReview: () -> Unit,
    onDismiss: () -> Unit,
) {
    val isPending = pendingOperation != null
    val currentIsPending by rememberUpdatedState(isPending)
    val sheetState = rememberModalBottomSheetState(
        skipPartiallyExpanded = true,
        confirmValueChange = { target -> target != SheetValue.Hidden || !currentIsPending },
    )
    var confirmation by remember(run.id) { mutableStateOf<AgentRunOperation?>(null) }

    ModalBottomSheet(
        onDismissRequest = { if (!isPending) onDismiss() },
        sheetState = sheetState,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(horizontal = 16.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                ClawStatusChip(text = run.status.localizedLabel(), tone = run.status.tone())
                Text(
                    text = stringResource(R.string.runs_attempt, run.attempt),
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Text(
                text = run.localizedDisplayTitle(),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
            )

            val unscoped = stringResource(R.string.runs_unscoped)
            Text(
                text = buildString {
                    append(run.projectTitle ?: unscoped)
                    append(" · ")
                    append(run.provider)
                    run.model?.let { append(" / $it") }
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            LinearProgressIndicator(
                progress = { run.progress.coerceIn(0, 100) / 100f },
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                text = run.progressMessage ?: stringResource(R.string.runs_progress_complete, run.progress),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            if (run.hostLabel != null || (run.provider == "paseo" && listOf(run.hostId, run.workspaceId, run.externalRunId).any { it != null })) {
                ClawSectionCard {
                    DetailProperty(stringResource(R.string.runs_property_host), run.hostLabel ?: run.hostId ?: "Paseo")
                    run.workspaceId?.let {
                        DetailProperty(stringResource(R.string.runs_property_workspace), it)
                    }
                    run.externalRunId?.let {
                        DetailProperty(stringResource(R.string.runs_property_external_run), it)
                    }
                }
            }

            run.error?.takeIf { it.isNotBlank() }?.let { message ->
                ClawSectionCard(tone = ClawTone.Error) {
                    Text(stringResource(R.string.runs_execution_error), fontWeight = FontWeight.SemiBold)
                    Text(message, style = MaterialTheme.typography.bodyMedium)
                }
            }

            (run.result ?: run.resultSummary)?.takeIf { it.isNotBlank() }?.let { result ->
                ClawSectionCard(tone = ClawTone.Success) {
                    Text(
                        stringResource(
                            if (run.result != null) R.string.runs_full_result else R.string.runs_result_summary,
                        ),
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        text = result,
                        style = MaterialTheme.typography.bodySmall,
                        fontFamily = FontFamily.Monospace,
                    )
                }
            }

            error?.let { ClawStatusChip(text = it, tone = ClawTone.Error) }
            notice?.let { ClawStatusChip(text = it, tone = ClawTone.Success) }

            if (run.status == AgentRunStatus.WAITING_INPUT || run.canRetry) {
                OutlinedTextField(
                    value = followUp,
                    onValueChange = onFollowUpChange,
                    modifier = Modifier.fillMaxWidth(),
                    label = {
                        Text(
                            if (run.status == AgentRunStatus.WAITING_INPUT) {
                                stringResource(R.string.runs_follow_up_instructions)
                            } else {
                                stringResource(R.string.runs_retry_guidance)
                            },
                        )
                    },
                    minLines = 2,
                    maxLines = 5,
                    enabled = !isPending,
                    supportingText = {
                        Text(stringResource(R.string.runs_character_count, followUp.length, 10_000))
                    },
                )
            }

            when {
                run.status == AgentRunStatus.WAITING_INPUT -> Button(
                    onClick = onResume,
                    enabled = followUp.isNotBlank() && !isPending,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (pendingOperation == AgentRunOperation.RESUME) {
                        SmallActionProgress()
                    }
                    Text(stringResource(R.string.runs_resume_with_follow_up))
                }

                run.canRetry -> Button(
                    onClick = { confirmation = AgentRunOperation.RETRY },
                    enabled = !isPending,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (pendingOperation == AgentRunOperation.RETRY) {
                        SmallActionProgress()
                    }
                    Text(stringResource(R.string.runs_retry_agent))
                }

                run.status == AgentRunStatus.WAITING_REVIEW -> Button(
                    onClick = onOpenReview,
                    enabled = !isPending,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(stringResource(R.string.runs_review_result))
                }
            }

            if (run.canCancel) {
                OutlinedButton(
                    onClick = { confirmation = AgentRunOperation.CANCEL },
                    enabled = !isPending,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (pendingOperation == AgentRunOperation.CANCEL) {
                        SmallActionProgress()
                    }
                    Text(stringResource(R.string.runs_cancel_run))
                }
            }

            HorizontalDivider()
            ClawSectionHeader(
                title = stringResource(R.string.runs_event_log),
                subtitle = stringResource(R.string.runs_event_log_description),
                count = events.size,
            )

            if (isLoading && events.isEmpty()) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center,
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(24.dp))
                }
            } else if (events.isEmpty()) {
                Text(
                    text = stringResource(R.string.runs_no_events),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                events.forEachIndexed { index, event ->
                    AgentRunEventRow(event)
                    if (index != events.lastIndex) HorizontalDivider()
                }
            }

            TextButton(
                onClick = onDismiss,
                enabled = !isPending,
                modifier = Modifier.align(Alignment.End),
            ) {
                Text(stringResource(R.string.runs_close))
            }
        }
    }

    confirmation?.let { operation ->
        val isRetry = operation == AgentRunOperation.RETRY
        AlertDialog(
            onDismissRequest = { if (!isPending) confirmation = null },
            title = {
                Text(
                    stringResource(
                        if (isRetry) R.string.runs_retry_dialog_title else R.string.runs_cancel_dialog_title,
                    ),
                )
            },
            text = {
                Text(
                    if (isRetry) {
                        stringResource(R.string.runs_retry_dialog_message)
                    } else {
                        stringResource(R.string.runs_cancel_dialog_message)
                    },
                )
            },
            confirmButton = {
                Button(
                    enabled = !isPending,
                    onClick = {
                        confirmation = null
                        if (isRetry) onRetry() else onCancel()
                    },
                ) {
                    Text(
                        stringResource(if (isRetry) R.string.runs_retry else R.string.runs_cancel_run),
                    )
                }
            },
            dismissButton = {
                TextButton(
                    enabled = !isPending,
                    onClick = { confirmation = null },
                ) {
                    Text(stringResource(R.string.runs_keep_run))
                }
            },
        )
    }
}

@Composable
private fun DetailProperty(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            text = label,
            modifier = Modifier.weight(0.35f),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = value,
            modifier = Modifier.weight(0.65f),
            style = MaterialTheme.typography.bodySmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun SmallActionProgress() {
    CircularProgressIndicator(
        modifier = Modifier
            .padding(end = 8.dp)
            .size(16.dp),
        strokeWidth = 2.dp,
    )
}

@Composable
private fun AgentRunEventRow(event: AgentRunEvent) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = formatRunTime(event.createdAt),
            modifier = Modifier.width(88.dp),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                text = event.localizedType(),
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold,
            )
            val detail = event.message ?: event.progress?.let { "$it%" }
            if (!detail.isNullOrBlank()) {
                Text(
                    text = detail,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

private fun AgentRunStatus.tone(): ClawTone = when (this) {
    AgentRunStatus.QUEUED -> ClawTone.Default
    AgentRunStatus.STARTING,
    AgentRunStatus.RUNNING,
    -> ClawTone.Primary
    AgentRunStatus.WAITING_INPUT,
    AgentRunStatus.WAITING_REVIEW,
    -> ClawTone.Warning
    AgentRunStatus.COMPLETED -> ClawTone.Success
    AgentRunStatus.FAILED,
    AgentRunStatus.CANCELLED,
    -> ClawTone.Error
}

@Composable
private fun AgentRunFilter.localizedLabel(): String = stringResource(
    when (this) {
        AgentRunFilter.ALL -> R.string.runs_filter_all
        AgentRunFilter.ACTIVE -> R.string.runs_filter_active
        AgentRunFilter.ATTENTION -> R.string.runs_filter_attention
        AgentRunFilter.RECENT -> R.string.runs_filter_recent
    },
)

@Composable
private fun AgentRunStatus.localizedLabel(): String = stringResource(
    when (this) {
        AgentRunStatus.QUEUED -> R.string.runs_status_queued
        AgentRunStatus.STARTING -> R.string.runs_status_starting
        AgentRunStatus.RUNNING -> R.string.runs_status_running
        AgentRunStatus.WAITING_INPUT -> R.string.runs_status_waiting_input
        AgentRunStatus.WAITING_REVIEW -> R.string.runs_status_waiting_review
        AgentRunStatus.COMPLETED -> R.string.runs_status_completed
        AgentRunStatus.FAILED -> R.string.runs_status_failed
        AgentRunStatus.CANCELLED -> R.string.runs_status_cancelled
    },
)

@Composable
private fun AgentRun.localizedDisplayTitle(): String =
    todoTitle?.takeIf(String::isNotBlank)
        ?: instructionSnapshot.lineSequence().firstOrNull(String::isNotBlank)
        ?: stringResource(R.string.runs_agent_run_fallback)

@Composable
private fun AgentRunEvent.localizedType(): String {
    val resource = when (eventType) {
        "approved" -> R.string.runs_event_approved
        "cancelled" -> R.string.runs_event_cancelled
        "changes_requested" -> R.string.runs_event_changes_requested
        "error" -> R.string.runs_event_error
        "failed" -> R.string.runs_event_failed
        "interrupted" -> R.string.runs_event_interrupted
        "migrated" -> R.string.runs_event_migrated
        "progress" -> R.string.runs_event_progress
        "provider_started" -> R.string.runs_event_provider_started
        "queued" -> R.string.runs_event_queued
        "rejected" -> R.string.runs_event_rejected
        "result" -> R.string.runs_event_result
        "returned_to_ready" -> R.string.runs_event_returned_to_ready
        "running" -> R.string.runs_event_running
        "starting" -> R.string.runs_event_starting
        "task_plan_applied" -> R.string.runs_event_task_plan_applied
        "task_plan_reverted" -> R.string.runs_event_task_plan_reverted
        "waiting_review" -> R.string.runs_event_waiting_review
        "workspace_created" -> R.string.runs_event_workspace_created
        else -> return eventType.replace('_', ' ')
    }
    return stringResource(resource)
}

internal fun formatRunTime(value: String): String {
    val zoned = runCatching {
        OffsetDateTime.parse(value).atZoneSameInstant(ZoneId.systemDefault())
    }.recoverCatching {
        LocalDateTime.parse(value).atZone(ZoneId.systemDefault())
    }.getOrNull()
    val formatter = DateTimeFormatter.ofPattern("MMM d · h:mm a", Locale.getDefault())
    return zoned?.format(formatter) ?: value
}
