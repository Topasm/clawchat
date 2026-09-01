package com.clawchat.android.feature.review

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.clawchat.android.core.data.model.ReviewDecision
import com.clawchat.android.core.data.model.AgentRun
import com.clawchat.android.core.data.model.AgentRunApprovalImpact
import com.clawchat.android.core.data.model.AgentRunEvent
import com.clawchat.android.core.data.model.AgentRunStatus
import com.clawchat.android.core.data.model.ReviewItem
import com.clawchat.android.core.data.model.ReviewRiskLevel
import com.clawchat.android.core.data.model.ReviewSubjectType
import com.clawchat.android.core.ui.ClawEmptyState
import com.clawchat.android.core.ui.ClawListItemSurface
import com.clawchat.android.core.ui.ClawSectionCard
import com.clawchat.android.core.ui.ClawStatusChip
import com.clawchat.android.core.ui.ClawTone
import com.clawchat.android.core.ui.ClawTopBarColors
import com.clawchat.android.core.ui.localizedErrorMessage
import kotlinx.serialization.json.jsonPrimitive

/** Mobile-first queue for inspecting and deciding plans, artifacts, and Agent Run results. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReviewInboxScreen(
    onBack: () -> Unit = {},
    initialReviewId: String? = null,
    onOpenSubject: (ReviewItem) -> Unit = {},
    /** Opens the exact waiting-input run after requesting changes. */
    onOpenRun: (String) -> Unit = {},
    viewModel: ReviewInboxViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var initialSelectionConsumed by rememberSaveable(initialReviewId) { mutableStateOf(false) }
    val selected = state.selected
    val feedback = state.error?.let { localizedErrorMessage(it) }
        ?: state.notice
        ?: state.errorResource?.let { stringResource(it) }
        ?: state.noticeResource?.let { stringResource(it) }

    LaunchedEffect(initialReviewId, state.items) {
        if (initialSelectionConsumed || initialReviewId == null) return@LaunchedEffect
        if (state.items.any { it.id == initialReviewId }) {
            initialSelectionConsumed = true
            viewModel.onAction(ReviewInboxAction.Select(initialReviewId))
        }
    }

    BackHandler(enabled = selected != null || state.isSubmitting) {
        if (!state.isSubmitting && selected != null) {
            viewModel.onAction(ReviewInboxAction.CloseDetail)
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            text = if (selected == null) {
                                stringResource(R.string.review_title)
                            } else {
                                selected.subjectTitle ?: stringResource(R.string.review_item_title)
                            },
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (selected == null) {
                            Text(
                                text = pluralStringResource(
                                    R.plurals.review_waiting_count,
                                    state.items.size,
                                    state.items.size,
                                ),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(
                        enabled = !state.isSubmitting,
                        onClick = {
                            if (selected != null) {
                                viewModel.onAction(ReviewInboxAction.CloseDetail)
                            } else {
                                onBack()
                            }
                        },
                    ) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.review_back),
                        )
                    }
                },
                actions = {
                    if (selected == null) {
                        IconButton(onClick = viewModel::refresh, enabled = !state.isRefreshing) {
                            Icon(
                                Icons.Default.Refresh,
                                contentDescription = stringResource(R.string.review_refresh),
                            )
                        }
                    }
                },
                colors = ClawTopBarColors(),
            )
        },
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            if (selected != null) {
                ReviewDetail(
                    state = state,
                    item = selected,
                    note = state.note,
                    isSubmitting = state.isSubmitting,
                    onNoteChange = { viewModel.onAction(ReviewInboxAction.UpdateNote(it)) },
                    onDecision = { viewModel.onAction(ReviewInboxAction.Decide(it)) },
                    onReloadDetail = { viewModel.onAction(ReviewInboxAction.ReloadDetail) },
                    // Preserve the original contract object: subjectId and
                    // subjectHref must survive native/mobile navigation.
                    onOpenSubject = { onOpenSubject(selected) },
                )
            } else {
                ReviewList(
                    state = state,
                    onRefresh = viewModel::refresh,
                    onSelect = { viewModel.onAction(ReviewInboxAction.Select(it)) },
                )
            }

            feedback?.let { message ->
                Snackbar(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(12.dp),
                    action = {
                        TextButton(
                            onClick = {
                                state.followUpRunId?.let(onOpenRun)
                                viewModel.onAction(ReviewInboxAction.DismissFeedback)
                            },
                        ) {
                            Text(
                                stringResource(
                                    if (state.followUpRunId != null) {
                                        R.string.review_open_run
                                    } else {
                                        R.string.review_dismiss
                                    },
                                ),
                            )
                        }
                    },
                ) {
                    Text(message)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReviewList(
    state: ReviewInboxUiState,
    onRefresh: () -> Unit,
    onSelect: (String) -> Unit,
) {
    PullToRefreshBox(
        isRefreshing = state.isRefreshing,
        onRefresh = onRefresh,
        modifier = Modifier.fillMaxSize(),
    ) {
        when {
            state.isLoading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(modifier = Modifier.size(28.dp))
            }
            state.items.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                ClawEmptyState(
                    title = stringResource(R.string.review_empty_title),
                    description = stringResource(R.string.review_empty_description),
                )
            }
            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(0.dp),
            ) {
                items(state.items, key = ReviewItem::id) { item ->
                    ReviewRow(item = item, onClick = { onSelect(item.id) })
                }
            }
        }
    }
}

@Composable
private fun ReviewRow(item: ReviewItem, onClick: () -> Unit) {
    ClawListItemSurface(onClick = onClick) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ClawStatusChip(text = item.subjectType.localizedLabel(), tone = item.riskLevel.tone)
            item.projectTitle?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Spacer(Modifier.weight(1f))
            Text(
                text = item.riskLevel.localizedLabel(),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            text = item.subjectTitle ?: item.summary,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        if (item.subjectTitle != null) {
            Text(
                text = item.summary,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        item.subjectDescription?.takeIf(String::isNotBlank)?.let {
            Text(
                text = it,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun ReviewDetail(
    state: ReviewInboxUiState,
    item: ReviewItem,
    note: String,
    isSubmitting: Boolean,
    onNoteChange: (String) -> Unit,
    onDecision: (ReviewDecision) -> Unit,
    onReloadDetail: () -> Unit,
    onOpenSubject: () -> Unit,
) {
    var pendingConfirmationDecision by remember(item.id) {
        mutableStateOf<ReviewDecision?>(null)
    }
    val requestDecision: (ReviewDecision) -> Unit = { decision ->
        if (requiresReviewConfirmation(item.riskLevel, decision)) {
            pendingConfirmationDecision = decision
        } else {
            onDecision(decision)
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            ClawSectionCard(tone = item.riskLevel.tone) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ClawStatusChip(item.subjectType.localizedLabel(), tone = item.riskLevel.tone)
                    ClawStatusChip(
                        stringResource(R.string.review_risk, item.riskLevel.localizedLabel()),
                        tone = item.riskLevel.tone,
                    )
                }
                Text(item.summary, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                item.subjectDescription?.takeIf(String::isNotBlank)?.let {
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Text(it, style = MaterialTheme.typography.bodyMedium)
                }
                ReviewMetadata(item)
                Text(
                    text = stringResource(R.string.review_subject_id, item.subjectId),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                item.subjectHref?.let { href ->
                    Text(
                        text = href,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (item.subjectHref != null) {
                    TextButton(onClick = onOpenSubject) {
                        Text(stringResource(R.string.review_open_source))
                    }
                }
            }
        }

        if (item.subjectType == ReviewSubjectType.AGENT_RUN) {
            item {
                AuthoritativeRunEvidence(
                    run = state.selectedRun,
                    events = state.selectedRunEvents,
                    impact = item.agentRunApprovalImpact,
                    isLoading = state.isDetailLoading,
                    error = state.detailError,
                    onRetry = onReloadDetail,
                )
            }
        }

        if (state.canDecideSelected) {
            item {
                OutlinedTextField(
                    value = note,
                    onValueChange = onNoteChange,
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text(stringResource(R.string.review_decision_note)) },
                    placeholder = { Text(stringResource(R.string.review_decision_note_hint)) },
                    minLines = 3,
                    maxLines = 7,
                    enabled = !isSubmitting,
                )
            }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(
                        onClick = { requestDecision(ReviewDecision.APPROVED) },
                        enabled = !isSubmitting,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        if (isSubmitting) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                strokeWidth = 2.dp,
                            )
                            Spacer(Modifier.width(8.dp))
                        }
                        Text(stringResource(R.string.review_approve))
                    }
                    OutlinedButton(
                        onClick = { requestDecision(ReviewDecision.CHANGES_REQUESTED) },
                        enabled = !isSubmitting,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(stringResource(R.string.review_request_changes))
                    }
                    TextButton(
                        onClick = { requestDecision(ReviewDecision.REJECTED) },
                        enabled = !isSubmitting,
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.textButtonColors(
                            contentColor = MaterialTheme.colorScheme.error,
                        ),
                    ) {
                        Text(stringResource(R.string.review_reject))
                    }
                }
            }
        } else {
            item {
                ClawSectionCard(tone = ClawTone.Warning) {
                    Text(
                        stringResource(
                            if (item.supportsDecision) {
                                R.string.review_decision_locked
                            } else {
                                R.string.review_desktop_action_required
                            },
                        ),
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        if (item.supportsDecision) {
                            stringResource(R.string.review_decision_locked_description)
                        } else {
                            stringResource(R.string.review_desktop_action_description)
                        },
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }

    pendingConfirmationDecision?.let { decision ->
        val isHighRisk = item.riskLevel == ReviewRiskLevel.HIGH
        AlertDialog(
            onDismissRequest = { if (!isSubmitting) pendingConfirmationDecision = null },
            title = {
                Text(
                    stringResource(
                        if (isHighRisk) {
                            R.string.review_confirm_high_risk_title
                        } else {
                            R.string.review_confirm_reject_title
                        },
                    ),
                )
            },
            text = {
                Text(
                    if (isHighRisk) {
                        stringResource(
                            R.string.review_confirm_high_risk_message,
                            decision.localizedLabel().lowercase(),
                        )
                    } else {
                        stringResource(R.string.review_confirm_reject_message)
                    },
                )
            },
            confirmButton = {
                Button(
                    enabled = !isSubmitting,
                    onClick = {
                        pendingConfirmationDecision = null
                        onDecision(decision)
                    },
                ) {
                    Text(
                        stringResource(R.string.review_confirm_action, decision.localizedLabel()),
                    )
                }
            },
            dismissButton = {
                TextButton(
                    enabled = !isSubmitting,
                    onClick = { pendingConfirmationDecision = null },
                ) {
                    Text(stringResource(R.string.review_cancel))
                }
            },
        )
    }
}

@Composable
private fun AuthoritativeRunEvidence(
    run: AgentRun?,
    events: List<AgentRunEvent>,
    impact: AgentRunApprovalImpact?,
    isLoading: Boolean,
    error: String?,
    onRetry: () -> Unit,
) {
    ClawSectionCard(tone = ClawTone.Primary) {
        Text(stringResource(R.string.review_authoritative_result), fontWeight = FontWeight.SemiBold)
        when {
            isLoading && run == null -> Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                Text(stringResource(R.string.review_loading_evidence))
            }
            error != null -> {
                Text(localizedErrorMessage(error), color = MaterialTheme.colorScheme.error)
                TextButton(onClick = onRetry) { Text(stringResource(R.string.review_retry)) }
            }
            run != null -> {
                Text(stringResource(R.string.review_original_instruction), style = MaterialTheme.typography.labelLarge)
                Text(run.instructionSnapshot, style = MaterialTheme.typography.bodyMedium)
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Text(stringResource(R.string.review_result), style = MaterialTheme.typography.labelLarge)
                Text(
                    run.result ?: stringResource(R.string.review_no_full_result),
                    style = MaterialTheme.typography.bodyMedium,
                )
                Text(
                    stringResource(
                        R.string.review_run_status,
                        run.status.localizedLabel(),
                        run.attempt,
                        run.provider,
                    ),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            else -> Text(stringResource(R.string.review_run_detail_unavailable))
        }

        impact?.let {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Text(stringResource(R.string.review_approval_impact), style = MaterialTheme.typography.labelLarge)
            val todoId = it.todoId
            Text(
                if (todoId != null) {
                    stringResource(
                        R.string.review_graph_revision_completes_task,
                        it.graphRevision,
                        todoId,
                    )
                } else {
                    stringResource(R.string.review_graph_revision, it.graphRevision)
                },
                style = MaterialTheme.typography.bodyMedium,
            )
            if (it.newlyReadyTasks.isNotEmpty()) {
                Text(
                    stringResource(
                        R.string.review_unlocks,
                        it.newlyReadyTasks.joinToString { task -> task.title },
                    ),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }

        if (events.isNotEmpty()) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Text(stringResource(R.string.review_latest_activity), style = MaterialTheme.typography.labelLarge)
            events.takeLast(5).forEach { event ->
                Text(
                    event.message?.let { message ->
                        stringResource(
                            R.string.review_event_with_message,
                            event.localizedType(),
                            message,
                        )
                    } ?: event.localizedType(),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

internal fun requiresReviewConfirmation(
    riskLevel: ReviewRiskLevel,
    decision: ReviewDecision,
): Boolean = riskLevel == ReviewRiskLevel.HIGH || decision == ReviewDecision.REJECTED

@Composable
private fun ReviewDecision.localizedLabel(): String = stringResource(
    when (this) {
        ReviewDecision.APPROVED -> R.string.review_approve
        ReviewDecision.CHANGES_REQUESTED -> R.string.review_request_changes
        ReviewDecision.REJECTED -> R.string.review_reject
    },
)

@Composable
private fun ReviewMetadata(item: ReviewItem) {
    val projectLabel = stringResource(R.string.review_metadata_project)
    val providerLabel = stringResource(R.string.review_metadata_provider)
    val runLabel = stringResource(R.string.review_metadata_run)
    val attemptLabel = stringResource(R.string.review_metadata_attempt)
    val versionLabel = stringResource(R.string.review_metadata_version)
    val localizedStatus = item.metadata["run_status"]
        ?.jsonPrimitive
        ?.content
        ?.let { localizedRunStatus(it) }
    val metadata = buildList {
        item.projectTitle?.let { add(projectLabel to it) }
        item.metadata["provider"]?.jsonPrimitive?.content?.let { add(providerLabel to it) }
        localizedStatus?.let { add(runLabel to it) }
        item.metadata["attempt"]?.jsonPrimitive?.content?.let { add(attemptLabel to it) }
        item.metadata["revision_version"]?.jsonPrimitive?.content?.let { add(versionLabel to it) }
    }
    if (metadata.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        metadata.forEach { (label, value) ->
            Row(modifier = Modifier.fillMaxWidth()) {
                Text(label, modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(value, fontWeight = FontWeight.Medium)
            }
        }
    }
}

@Composable
private fun ReviewSubjectType.localizedLabel(): String = stringResource(
    when (this) {
        ReviewSubjectType.PLAN_PROPOSAL -> R.string.review_subject_plan
        ReviewSubjectType.ARTIFACT_REVISION -> R.string.review_subject_artifact
        ReviewSubjectType.AGENT_RUN -> R.string.review_subject_agent_result
        ReviewSubjectType.CODE_DIFF -> R.string.review_subject_code_diff
        ReviewSubjectType.SCHEDULE_CHANGE -> R.string.review_subject_schedule
        ReviewSubjectType.SYNC_CONFLICT -> R.string.review_subject_sync_conflict
        ReviewSubjectType.UNKNOWN -> R.string.review_subject_unknown
    },
)

@Composable
private fun ReviewRiskLevel.localizedLabel(): String = stringResource(
    when (this) {
        ReviewRiskLevel.LOW -> R.string.review_risk_low
        ReviewRiskLevel.MEDIUM -> R.string.review_risk_medium
        ReviewRiskLevel.HIGH -> R.string.review_risk_high
    },
)

@Composable
private fun AgentRunStatus.localizedLabel(): String = stringResource(
    when (this) {
        AgentRunStatus.QUEUED -> R.string.review_status_queued
        AgentRunStatus.STARTING -> R.string.review_status_starting
        AgentRunStatus.RUNNING -> R.string.review_status_running
        AgentRunStatus.WAITING_INPUT -> R.string.review_status_waiting_input
        AgentRunStatus.WAITING_REVIEW -> R.string.review_status_waiting_review
        AgentRunStatus.COMPLETED -> R.string.review_status_completed
        AgentRunStatus.FAILED -> R.string.review_status_failed
        AgentRunStatus.CANCELLED -> R.string.review_status_cancelled
    },
)

@Composable
private fun localizedRunStatus(status: String): String {
    val resource = when (status) {
        "queued" -> R.string.review_status_queued
        "starting" -> R.string.review_status_starting
        "running" -> R.string.review_status_running
        "waiting_input" -> R.string.review_status_waiting_input
        "waiting_review" -> R.string.review_status_waiting_review
        "completed" -> R.string.review_status_completed
        "failed" -> R.string.review_status_failed
        "cancelled" -> R.string.review_status_cancelled
        else -> return status.replace('_', ' ')
    }
    return stringResource(resource)
}

@Composable
private fun AgentRunEvent.localizedType(): String {
    val resource = when (eventType) {
        "approved" -> R.string.review_event_approved
        "cancelled" -> R.string.review_event_cancelled
        "changes_requested" -> R.string.review_event_changes_requested
        "error" -> R.string.review_event_error
        "failed" -> R.string.review_event_failed
        "interrupted" -> R.string.review_event_interrupted
        "migrated" -> R.string.review_event_migrated
        "progress" -> R.string.review_event_progress
        "provider_started" -> R.string.review_event_provider_started
        "queued" -> R.string.review_event_queued
        "rejected" -> R.string.review_event_rejected
        "result" -> R.string.review_event_result
        "returned_to_ready" -> R.string.review_event_returned_to_ready
        "running" -> R.string.review_event_running
        "starting" -> R.string.review_event_starting
        "task_plan_applied" -> R.string.review_event_task_plan_applied
        "task_plan_reverted" -> R.string.review_event_task_plan_reverted
        "waiting_review" -> R.string.review_event_waiting_review
        "workspace_created" -> R.string.review_event_workspace_created
        else -> return eventType.replace('_', ' ')
    }
    return stringResource(resource)
}

private val ReviewRiskLevel.tone: ClawTone
    get() = when (this) {
        ReviewRiskLevel.LOW -> ClawTone.Success
        ReviewRiskLevel.MEDIUM -> ClawTone.Warning
        ReviewRiskLevel.HIGH -> ClawTone.Error
    }
