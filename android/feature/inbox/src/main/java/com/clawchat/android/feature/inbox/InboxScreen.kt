package com.clawchat.android.feature.inbox

import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.ui.ClawEmptyState
import com.clawchat.android.core.ui.ClawMetricPill
import com.clawchat.android.core.ui.ClawSectionCard
import com.clawchat.android.core.ui.ClawSectionHeader
import com.clawchat.android.core.ui.ClawStatusChip
import com.clawchat.android.core.ui.ClawTone
import com.clawchat.android.core.ui.ClawTopBarTitle
import com.clawchat.android.core.ui.icons.ClawIcons

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InboxScreen(
    viewModel: InboxViewModel = hiltViewModel(),
    onTaskClick: (String) -> Unit = {},
) {
    val state by viewModel.uiState.collectAsState()
    val totalItems = state.planningNow.size + state.reviewSuggestion.size + state.needsOrganizing.size + state.failed.size

    Scaffold(
        topBar = {
            LargeTopAppBar(
                title = {
                    ClawTopBarTitle(
                        title = "Inbox",
                        subtitle = "Capture first, decide with context.",
                    )
                },
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
            if (state.isLoading) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = "Loading inbox...",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 32.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    item {
                        InboxSummaryCard(
                            totalItems = totalItems,
                            planningNow = state.planningNow.size,
                            reviewSuggestion = state.reviewSuggestion.size,
                            failed = state.failed.size,
                        )
                    }

                    if (state.planningNow.isNotEmpty()) {
                        item {
                            InboxSectionCard(
                                title = "Planning now",
                                subtitle = "The assistant is actively classifying or planning these items.",
                                tone = ClawTone.Primary,
                                icon = {
                                    Icon(Icons.Default.Refresh, contentDescription = null)
                                },
                                items = state.planningNow,
                                actionLabel = null,
                                onAction = null,
                                isError = false,
                                showSpinner = true,
                                onTaskClick = onTaskClick,
                            )
                        }
                    }

                    if (state.reviewSuggestion.isNotEmpty()) {
                        item {
                            InboxSectionCard(
                                title = "Review suggestion",
                                subtitle = "AI has a recommendation ready for your confirmation.",
                                tone = ClawTone.Warning,
                                icon = {
                                    Icon(Icons.Default.CheckCircle, contentDescription = null)
                                },
                                items = state.reviewSuggestion,
                                actionLabel = "Review",
                                onAction = viewModel::organize,
                                isError = false,
                                showSpinner = false,
                                onTaskClick = onTaskClick,
                            )
                        }
                    }

                    if (state.needsOrganizing.isNotEmpty()) {
                        item {
                            InboxSectionCard(
                                title = "Needs organizing",
                                subtitle = "Captured items that still need structure or routing.",
                                tone = ClawTone.Default,
                                icon = {
                                    Icon(ClawIcons.Inbox, contentDescription = null)
                                },
                                items = state.needsOrganizing,
                                actionLabel = "Organize",
                                onAction = viewModel::organize,
                                isError = false,
                                showSpinner = false,
                                onTaskClick = onTaskClick,
                            )
                        }
                    }

                    if (state.failed.isNotEmpty()) {
                        item {
                            InboxSectionCard(
                                title = "Failed",
                                subtitle = "These items need another attempt or a manual check.",
                                tone = ClawTone.Error,
                                icon = {
                                    Icon(Icons.Default.Refresh, contentDescription = null)
                                },
                                items = state.failed,
                                actionLabel = "Retry",
                                onAction = viewModel::retryOrganize,
                                isError = true,
                                showSpinner = false,
                                onTaskClick = onTaskClick,
                            )
                        }
                    }

                    if (isEmpty(state)) {
                        item {
                            ClawEmptyState(
                                title = "Inbox is clear",
                                description = "New captures will appear here when they need planning or review.",
                                icon = {
                                    Icon(
                                        Icons.Default.CheckCircle,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.primary,
                                    )
                                },
                            )
                        }
                    }
                }
            }

            state.error?.let { error ->
                Snackbar(
                    modifier = Modifier
                        .padding(16.dp)
                        .align(Alignment.BottomCenter),
                ) {
                    Text(error)
                }
            }
        }
    }
}

private fun isEmpty(state: InboxUiState): Boolean =
    state.planningNow.isEmpty() &&
        state.reviewSuggestion.isEmpty() &&
        state.needsOrganizing.isEmpty() &&
        state.failed.isEmpty()

@Composable
private fun InboxSummaryCard(
    totalItems: Int,
    planningNow: Int,
    reviewSuggestion: Int,
    failed: Int,
) {
    ClawSectionCard(tone = ClawTone.Primary) {
        Text(
            text = if (totalItems == 0) "Nothing waiting right now" else "$totalItems item${if (totalItems == 1) "" else "s"} need attention",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = "Use this queue to confirm AI suggestions, fix failures, and turn captures into structured work.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.82f),
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            ClawMetricPill(
                label = "Planning",
                value = planningNow.toString(),
                modifier = Modifier.weight(1f),
            )
            ClawMetricPill(
                label = "Review",
                value = reviewSuggestion.toString(),
                modifier = Modifier.weight(1f),
            )
            ClawMetricPill(
                label = "Failed",
                value = failed.toString(),
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun InboxSectionCard(
    title: String,
    subtitle: String,
    tone: ClawTone,
    icon: @Composable () -> Unit,
    items: List<Todo>,
    actionLabel: String?,
    onAction: ((String) -> Unit)?,
    isError: Boolean,
    showSpinner: Boolean,
    onTaskClick: (String) -> Unit,
) {
    ClawSectionCard(tone = tone) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(
                modifier = Modifier.size(42.dp),
                shape = MaterialTheme.shapes.medium,
                color = MaterialTheme.colorScheme.surface,
            ) {
                Box(contentAlignment = Alignment.Center) {
                    icon()
                }
            }
            ClawSectionHeader(
                modifier = Modifier.weight(1f),
                title = title,
                subtitle = subtitle,
                count = items.size,
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items.forEachIndexed { index, todo ->
                InboxItemCard(
                    todo = todo,
                    showSpinner = showSpinner,
                    actionLabel = actionLabel,
                    onAction = if (actionLabel != null && onAction != null) {
                        { onAction(todo.id) }
                    } else {
                        null
                    },
                    onClick = { onTaskClick(todo.id) },
                    isError = isError,
                )
                if (index != items.lastIndex) {
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.6f))
                }
            }
        }
    }
}

@Composable
private fun InboxItemCard(
    todo: Todo,
    showSpinner: Boolean = false,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
    onClick: () -> Unit = {},
    isError: Boolean = false,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surface,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 14.dp)
                .clickable(onClick = onClick),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.Top,
            ) {
                if (showSpinner) {
                    ClawStatusChip(
                        text = "Working",
                        tone = ClawTone.Primary,
                    )
                } else {
                    ClawStatusChip(
                        text = when {
                            isError -> "Attention"
                            todo.inboxState == "plan_ready" -> "Suggestion"
                            else -> "Captured"
                        },
                        tone = if (isError) ClawTone.Error else ClawTone.Warning,
                    )
                }
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        text = todo.title,
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    val summary = todo.planSummary ?: todo.nextAction
                    if (!summary.isNullOrBlank()) {
                        Text(
                            text = summary,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    val automationError = todo.automationError
                    if (isError && !automationError.isNullOrBlank()) {
                        Text(
                            text = automationError,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }

            if (actionLabel != null && onAction != null) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                ) {
                    FilledTonalButton(onClick = onAction) {
                        if (isError) {
                            Icon(
                                Icons.Default.Refresh,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp),
                            )
                            Spacer(Modifier.size(6.dp))
                        }
                        Text(actionLabel)
                    }
                }
            }
        }
    }
}
