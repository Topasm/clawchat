package com.clawchat.android.feature.progress

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.clawchat.android.core.data.model.AgentRun
import com.clawchat.android.core.data.model.AgentRunStatus
import com.clawchat.android.core.data.model.ReviewItem
import com.clawchat.android.core.data.model.ReviewRiskLevel
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.ui.ClawEmptyState
import com.clawchat.android.core.ui.ClawListItemSurface
import com.clawchat.android.core.ui.ClawNavigationMenuButton
import com.clawchat.android.core.ui.ClawSectionCard
import com.clawchat.android.core.ui.ClawSectionHeader
import com.clawchat.android.core.ui.ClawStatusChip
import com.clawchat.android.core.ui.ClawTone
import com.clawchat.android.core.ui.ClawTopBarColors
import com.clawchat.android.core.ui.localizedErrorMessage
import kotlinx.coroutines.delay

private const val ACTIVE_POLL_INTERVAL_MS = 3_000L

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProgressScreen(
    onOpenNavigation: () -> Unit = {},
    onOpenReview: () -> Unit = {},
    onOpenRun: (String) -> Unit = {},
    onOpenRuns: () -> Unit = {},
    onOpenTask: (String) -> Unit = {},
    onOpenTasks: () -> Unit = {},
    viewModel: ProgressViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

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
                        text = stringResource(R.string.progress_title),
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold,
                    )
                },
                navigationIcon = { ClawNavigationMenuButton(onClick = onOpenNavigation) },
                actions = {
                    IconButton(onClick = viewModel::refresh, enabled = !state.isRefreshing) {
                        Icon(
                            Icons.Default.Refresh,
                            contentDescription = stringResource(R.string.progress_refresh),
                        )
                    }
                },
                colors = ClawTopBarColors(),
            )
        },
    ) { padding ->
        when {
            state.isLoading && !state.hasAnyContent -> Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator()
            }

            else -> ProgressContent(
                state = state,
                onOpenReview = onOpenReview,
                onOpenRun = onOpenRun,
                onOpenRuns = onOpenRuns,
                onOpenTask = onOpenTask,
                onOpenTasks = onOpenTasks,
                onRetryPending = viewModel::retryPending,
                modifier = Modifier.padding(padding),
            )
        }
    }
}

@Composable
private fun ProgressContent(
    state: ProgressUiState,
    onOpenReview: () -> Unit,
    onOpenRun: (String) -> Unit,
    onOpenRuns: () -> Unit,
    onOpenTask: (String) -> Unit,
    onOpenTasks: () -> Unit,
    onRetryPending: () -> Unit,
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

        if (state.pendingReviews.isNotEmpty() || state.attentionRuns.isNotEmpty()) {
            item(key = "attention_header") {
                ClawSectionHeader(
                    title = stringResource(R.string.progress_attention_title),
                    subtitle = stringResource(R.string.progress_attention_description),
                    count = state.attentionCount,
                    actionLabel = if (state.pendingReviews.isNotEmpty()) {
                        stringResource(R.string.progress_open_review)
                    } else null,
                    onActionClick = if (state.pendingReviews.isNotEmpty()) onOpenReview else null,
                )
            }
            items(state.pendingReviews, key = { "review:${it.id}" }) { review ->
                ReviewProgressRow(review = review, onClick = onOpenReview)
            }
            items(state.attentionRuns, key = { "attention-run:${it.id}" }) { run ->
                AgentRunProgressRow(run = run, onClick = { onOpenRun(run.id) })
            }
        }

        if (state.executingRuns.isNotEmpty()) {
            item(key = "runs_header") {
                ClawSectionHeader(
                    title = stringResource(R.string.progress_agent_title),
                    subtitle = stringResource(R.string.progress_agent_description),
                    count = state.executingRuns.size,
                    actionLabel = stringResource(R.string.progress_open_runs),
                    onActionClick = onOpenRuns,
                )
            }
            items(state.executingRuns, key = { "run:${it.id}" }) { run ->
                AgentRunProgressRow(run = run, onClick = { onOpenRun(run.id) })
            }
        }

        item(key = "tasks_header") {
            ClawSectionHeader(
                title = stringResource(R.string.progress_tasks_title),
                subtitle = stringResource(R.string.progress_tasks_description),
                count = state.inProgressTasks.size,
                actionLabel = stringResource(R.string.progress_open_tasks),
                onActionClick = onOpenTasks,
            )
        }
        items(state.inProgressTasks, key = { "task:${it.id}" }) { task ->
            TaskProgressRow(task = task, onClick = { onOpenTask(task.id) })
        }
        if (state.inProgressTasks.isEmpty()) {
            item(key = "tasks_empty") {
                Text(
                    text = stringResource(R.string.progress_tasks_empty),
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        if (state.recentlyFinishedRuns.isNotEmpty() || state.recentlyCompletedTasks.isNotEmpty()) {
            item(key = "recent_header") {
                ClawSectionHeader(
                    title = stringResource(R.string.progress_recent_title),
                    subtitle = stringResource(R.string.progress_recent_description),
                )
            }
            items(state.recentlyFinishedRuns, key = { "recent-run:${it.id}" }) { run ->
                AgentRunProgressRow(run = run, onClick = { onOpenRun(run.id) })
            }
            items(state.recentlyCompletedTasks, key = { "recent-task:${it.id}" }) { task ->
                TaskProgressRow(task = task, onClick = { onOpenTask(task.id) })
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
                    text = stringResource(R.string.progress_summary, state.attentionCount, state.activeCount),
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
private fun ReviewProgressRow(review: ReviewItem, onClick: () -> Unit) {
    ClawListItemSurface(onClick = onClick) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    text = review.subjectTitle?.takeIf(String::isNotBlank) ?: review.summary,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = review.summary,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            ClawStatusChip(
                text = reviewRiskLabel(review.riskLevel),
                tone = when (review.riskLevel) {
                    ReviewRiskLevel.HIGH -> ClawTone.Error
                    ReviewRiskLevel.MEDIUM -> ClawTone.Warning
                    ReviewRiskLevel.LOW -> ClawTone.Default
                },
            )
        }
    }
}

@Composable
private fun AgentRunProgressRow(run: AgentRun, onClick: () -> Unit) {
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
                    text = run.progressMessage?.takeIf(String::isNotBlank)
                        ?: agentRunStatusLabel(run.status),
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
    }
}

@Composable
private fun TaskProgressRow(task: Todo, onClick: () -> Unit) {
    ClawListItemSurface(onClick = onClick) {
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
                    maxLines = 1,
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
                text = stringResource(
                    if (task.syncStatus == "pending") R.string.progress_task_sync_pending
                    else R.string.progress_task_state,
                ),
                tone = if (task.syncStatus == "pending") ClawTone.Warning else ClawTone.Primary,
            )
        }
    }
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

@Composable
private fun reviewRiskLabel(risk: ReviewRiskLevel): String = stringResource(
    when (risk) {
        ReviewRiskLevel.LOW -> R.string.progress_risk_low
        ReviewRiskLevel.MEDIUM -> R.string.progress_risk_medium
        ReviewRiskLevel.HIGH -> R.string.progress_risk_high
    },
)
