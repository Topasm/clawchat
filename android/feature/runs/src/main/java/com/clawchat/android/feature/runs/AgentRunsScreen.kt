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
import kotlinx.coroutines.delay
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private const val ACTIVE_POLL_INTERVAL_MS = 3_000L
private val RUN_TIME_FORMAT = DateTimeFormatter.ofPattern("MMM d · h:mm a")

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
                        text = "Agent runs",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold,
                    )
                },
                navigationIcon = {
                    if (onBack != null) {
                        IconButton(onClick = onBack) {
                            Icon(
                                Icons.AutoMirrored.Filled.ArrowBack,
                                contentDescription = "Back",
                            )
                        }
                    }
                },
                actions = {
                    IconButton(onClick = viewModel::refresh) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh runs")
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

                    state.error?.let { message ->
                        item {
                            ClawStatusChip(text = message, tone = ClawTone.Error)
                        }
                    }

                    state.notice?.let { message ->
                        item {
                            ClawStatusChip(text = message, tone = ClawTone.Success)
                        }
                    }

                    if (state.visibleRuns.isEmpty()) {
                        item {
                            ClawEmptyState(
                                title = "No runs in this view",
                                description = "Agent attempts will appear here when work is delegated.",
                                actionLabel = "Refresh",
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
            error = state.error,
            notice = state.notice,
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
                text = "Loading agent runs…",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun RunSummaryCard(state: AgentRunsUiState) {
    ClawSectionCard(tone = if (state.attentionCount > 0) ClawTone.Warning else ClawTone.Primary) {
        ClawSectionHeader(
            title = "Execution overview",
            subtitle = if (state.attentionCount > 0) {
                "${state.attentionCount} run${if (state.attentionCount == 1) "" else "s"} need your attention."
            } else {
                "Agent work is moving without blockers."
            },
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ClawMetricPill(
                label = "Active",
                value = state.activeCount.toString(),
                modifier = Modifier.weight(1f),
            )
            ClawMetricPill(
                label = "Attention",
                value = state.attentionCount.toString(),
                modifier = Modifier.weight(1f),
            )
            ClawMetricPill(
                label = "Failed",
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
                label = { Text(filter.label) },
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
                text = run.status.label,
                tone = run.status.tone(),
            )
            Text(
                text = "Attempt ${run.attempt}",
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
            text = run.displayTitle,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )

        Text(
            text = buildString {
                append(run.projectTitle ?: "Unscoped")
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
                    AgentRunStatus.WAITING_INPUT -> "Waiting for your follow-up"
                    AgentRunStatus.WAITING_REVIEW -> "Result is ready to review"
                    else -> "${run.progress}% complete"
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
                ClawStatusChip(text = run.status.label, tone = run.status.tone())
                Text(
                    text = "Attempt ${run.attempt}",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Text(
                text = run.displayTitle,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
            )

            Text(
                text = buildString {
                    append(run.projectTitle ?: "Unscoped")
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
                text = run.progressMessage ?: "${run.progress}% complete",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            if (run.provider == "paseo" && listOf(run.hostId, run.workspaceId, run.externalRunId).any { it != null }) {
                ClawSectionCard {
                    DetailProperty("Host", run.hostId ?: "Paseo")
                    run.workspaceId?.let { DetailProperty("Workspace", it) }
                    run.externalRunId?.let { DetailProperty("External run", it) }
                }
            }

            run.error?.takeIf { it.isNotBlank() }?.let { message ->
                ClawSectionCard(tone = ClawTone.Error) {
                    Text("Execution error", fontWeight = FontWeight.SemiBold)
                    Text(message, style = MaterialTheme.typography.bodyMedium)
                }
            }

            (run.result ?: run.resultSummary)?.takeIf { it.isNotBlank() }?.let { result ->
                ClawSectionCard(tone = ClawTone.Success) {
                    Text(
                        if (run.result != null) "Full result" else "Result summary",
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
                                "Follow-up instructions"
                            } else {
                                "Retry guidance (optional)"
                            },
                        )
                    },
                    minLines = 2,
                    maxLines = 5,
                    enabled = !isPending,
                    supportingText = {
                        Text("${followUp.length} / 10,000")
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
                    Text("Resume with follow-up")
                }

                run.canRetry -> Button(
                    onClick = { confirmation = AgentRunOperation.RETRY },
                    enabled = !isPending,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (pendingOperation == AgentRunOperation.RETRY) {
                        SmallActionProgress()
                    }
                    Text("Retry agent run")
                }

                run.status == AgentRunStatus.WAITING_REVIEW -> Button(
                    onClick = onOpenReview,
                    enabled = !isPending,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Review result")
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
                    Text("Cancel run")
                }
            }

            HorizontalDivider()
            ClawSectionHeader(
                title = "Event log",
                subtitle = "Provider heartbeats and lifecycle changes.",
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
                    text = "No events recorded yet.",
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
                Text("Close")
            }
        }
    }

    confirmation?.let { operation ->
        val isRetry = operation == AgentRunOperation.RETRY
        AlertDialog(
            onDismissRequest = { if (!isPending) confirmation = null },
            title = { Text(if (isRetry) "Retry agent run?" else "Cancel agent run?") },
            text = {
                Text(
                    if (isRetry) {
                        "This starts a new execution attempt. The previous attempt remains in history."
                    } else {
                        "The provider will be asked to stop. Partial external changes may already exist."
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
                    Text(if (isRetry) "Retry" else "Cancel run")
                }
            },
            dismissButton = {
                TextButton(
                    enabled = !isPending,
                    onClick = { confirmation = null },
                ) {
                    Text("Keep run")
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
                text = event.eventType.replace('_', ' '),
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

internal fun formatRunTime(value: String): String {
    val zoned = runCatching {
        OffsetDateTime.parse(value).atZoneSameInstant(ZoneId.systemDefault())
    }.recoverCatching {
        LocalDateTime.parse(value).atZone(ZoneId.systemDefault())
    }.getOrNull()
    return zoned?.format(RUN_TIME_FORMAT) ?: value
}
