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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.clawchat.android.core.data.model.ReviewDecision
import com.clawchat.android.core.data.model.AgentRun
import com.clawchat.android.core.data.model.AgentRunApprovalImpact
import com.clawchat.android.core.data.model.AgentRunEvent
import com.clawchat.android.core.data.model.ReviewItem
import com.clawchat.android.core.data.model.ReviewRiskLevel
import com.clawchat.android.core.data.model.ReviewSubjectType
import com.clawchat.android.core.ui.ClawEmptyState
import com.clawchat.android.core.ui.ClawListItemSurface
import com.clawchat.android.core.ui.ClawSectionCard
import com.clawchat.android.core.ui.ClawStatusChip
import com.clawchat.android.core.ui.ClawTone
import com.clawchat.android.core.ui.ClawTopBarColors
import kotlinx.serialization.json.jsonPrimitive

/** Mobile-first queue for inspecting and deciding plans, artifacts, and Agent Run results. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReviewInboxScreen(
    onBack: () -> Unit = {},
    onOpenSubject: (ReviewItem) -> Unit = {},
    /** Opens the exact waiting-input run after requesting changes. */
    onOpenRun: (String) -> Unit = {},
    viewModel: ReviewInboxViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val selected = state.selected

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
                            text = if (selected == null) "Review" else selected.subjectTitle ?: "Review item",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (selected == null) {
                            Text(
                                text = "${state.items.size} waiting for your decision",
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
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    if (selected == null) {
                        IconButton(onClick = viewModel::refresh, enabled = !state.isRefreshing) {
                            Icon(Icons.Default.Refresh, contentDescription = "Refresh reviews")
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

            (state.error ?: state.notice)?.let { feedback ->
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
                            Text(if (state.followUpRunId != null) "Open run" else "Dismiss")
                        }
                    },
                ) {
                    Text(feedback)
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
                    title = "All caught up",
                    description = "Plans and agent results that need a decision will appear here.",
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
            ClawStatusChip(text = item.subjectType.label, tone = item.riskLevel.tone)
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
                text = item.riskLevel.label,
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
                    ClawStatusChip(item.subjectType.label, tone = item.riskLevel.tone)
                    ClawStatusChip("${item.riskLevel.label} risk", tone = item.riskLevel.tone)
                }
                Text(item.summary, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                item.subjectDescription?.takeIf(String::isNotBlank)?.let {
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Text(it, style = MaterialTheme.typography.bodyMedium)
                }
                ReviewMetadata(item)
                Text(
                    text = "Subject ${item.subjectId}",
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
                    TextButton(onClick = onOpenSubject) { Text("Open source") }
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
                    label = { Text("Decision note") },
                    placeholder = { Text("Optional context or requested changes") },
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
                        Text("Approve")
                    }
                    OutlinedButton(
                        onClick = { requestDecision(ReviewDecision.CHANGES_REQUESTED) },
                        enabled = !isSubmitting,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Request changes")
                    }
                    TextButton(
                        onClick = { requestDecision(ReviewDecision.REJECTED) },
                        enabled = !isSubmitting,
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.textButtonColors(
                            contentColor = MaterialTheme.colorScheme.error,
                        ),
                    ) {
                        Text("Reject")
                    }
                }
            }
        } else {
            item {
                ClawSectionCard(tone = ClawTone.Warning) {
                    Text(
                        if (item.supportsDecision) "Decision locked" else "Desktop action required",
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        if (item.supportsDecision) {
                            "The original instruction, authoritative result, and approval impact must all load before a decision is safe."
                        } else {
                            "This item is read-only on Android until its complete plan or artifact source can be inspected."
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
                    if (isHighRisk) "Confirm high-risk decision" else "Reject agent result?",
                )
            },
            text = {
                Text(
                    if (isHighRisk) {
                        "This result can change task and graph state. Confirm ${decision.label.lowercase()} only after checking the original, result, and impact."
                    } else {
                        "Rejecting this result can mark its task as failed. Confirm only after checking the original instruction and full result."
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
                    Text("Confirm ${decision.label}")
                }
            },
            dismissButton = {
                TextButton(
                    enabled = !isSubmitting,
                    onClick = { pendingConfirmationDecision = null },
                ) {
                    Text("Cancel")
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
        Text("Authoritative agent result", fontWeight = FontWeight.SemiBold)
        when {
            isLoading && run == null -> Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                Text("Loading original and result…")
            }
            error != null -> {
                Text(error, color = MaterialTheme.colorScheme.error)
                TextButton(onClick = onRetry) { Text("Retry") }
            }
            run != null -> {
                Text("Original instruction", style = MaterialTheme.typography.labelLarge)
                Text(run.instructionSnapshot, style = MaterialTheme.typography.bodyMedium)
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Text("Result", style = MaterialTheme.typography.labelLarge)
                Text(
                    run.result ?: "No authoritative full result was provided.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Text(
                    "Status ${run.status.label} · attempt ${run.attempt} · ${run.provider}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            else -> Text("Run detail is not available.")
        }

        impact?.let {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Text("Approval impact", style = MaterialTheme.typography.labelLarge)
            Text(
                "Graph revision ${it.graphRevision}" +
                    (it.todoId?.let { todoId -> " · completes task $todoId" } ?: ""),
                style = MaterialTheme.typography.bodyMedium,
            )
            if (it.newlyReadyTasks.isNotEmpty()) {
                Text(
                    "Unlocks: ${it.newlyReadyTasks.joinToString { task -> task.title }}",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }

        if (events.isNotEmpty()) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Text("Latest activity", style = MaterialTheme.typography.labelLarge)
            events.takeLast(5).forEach { event ->
                Text(
                    "${event.eventType.replace('_', ' ')}${event.message?.let { ": $it" }.orEmpty()}",
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

private val ReviewDecision.label: String
    get() = when (this) {
        ReviewDecision.APPROVED -> "Approve"
        ReviewDecision.CHANGES_REQUESTED -> "Request changes"
        ReviewDecision.REJECTED -> "Reject"
    }

@Composable
private fun ReviewMetadata(item: ReviewItem) {
    val metadata = buildList {
        item.projectTitle?.let { add("Project" to it) }
        item.metadata["provider"]?.jsonPrimitive?.content?.let { add("Provider" to it) }
        item.metadata["run_status"]?.jsonPrimitive?.content?.let { add("Run" to it.replace('_', ' ')) }
        item.metadata["attempt"]?.jsonPrimitive?.content?.let { add("Attempt" to it) }
        item.metadata["revision_version"]?.jsonPrimitive?.content?.let { add("Version" to it) }
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

private val ReviewSubjectType.label: String
    get() = when (this) {
        ReviewSubjectType.PLAN_PROPOSAL -> "Plan"
        ReviewSubjectType.ARTIFACT_REVISION -> "Artifact"
        ReviewSubjectType.AGENT_RUN -> "Agent result"
        ReviewSubjectType.CODE_DIFF -> "Code diff"
        ReviewSubjectType.SCHEDULE_CHANGE -> "Schedule"
        ReviewSubjectType.SYNC_CONFLICT -> "Sync conflict"
        ReviewSubjectType.UNKNOWN -> "Review"
    }

private val ReviewRiskLevel.label: String
    get() = name.lowercase().replaceFirstChar(Char::uppercase)

private val ReviewRiskLevel.tone: ClawTone
    get() = when (this) {
        ReviewRiskLevel.LOW -> ClawTone.Success
        ReviewRiskLevel.MEDIUM -> ClawTone.Warning
        ReviewRiskLevel.HIGH -> ClawTone.Error
    }
