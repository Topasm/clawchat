package com.clawchat.android.feature.inbox

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
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.ui.ClawEmptyState
import com.clawchat.android.core.ui.ClawListSection
import com.clawchat.android.core.ui.ClawListItemSurface
import com.clawchat.android.core.ui.ClawNavigationMenuButton
import com.clawchat.android.core.ui.ClawSectionHeader
import com.clawchat.android.core.ui.ClawStatusChip
import com.clawchat.android.core.ui.ClawTone
import com.clawchat.android.core.ui.ClawTopBarColors
import com.clawchat.android.core.ui.icons.ClawIcons
import com.clawchat.android.core.ui.localizedErrorMessage

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InboxScreen(
    viewModel: InboxViewModel = hiltViewModel(),
    onTaskClick: (String) -> Unit = {},
    onOpenNavigation: () -> Unit = {},
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val totalItems = state.planningNow.size + state.reviewSuggestion.size + state.needsOrganizing.size + state.failed.size

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
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
                    ClawNavigationMenuButton(onClick = onOpenNavigation)
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
            if (state.isLoading) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = stringResource(R.string.inbox_loading),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 4.dp, bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
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
                                title = stringResource(R.string.inbox_planning_title),
                                subtitle = stringResource(R.string.inbox_planning_subtitle),
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
                                title = stringResource(R.string.inbox_review_title),
                                subtitle = stringResource(R.string.inbox_review_subtitle),
                                tone = ClawTone.Warning,
                                icon = {
                                    Icon(Icons.Default.CheckCircle, contentDescription = null)
                                },
                                items = state.reviewSuggestion,
                                actionLabel = stringResource(R.string.inbox_action_review),
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
                                title = stringResource(R.string.inbox_organize_title),
                                subtitle = stringResource(R.string.inbox_organize_subtitle),
                                tone = ClawTone.Default,
                                icon = {
                                    Icon(ClawIcons.Inbox, contentDescription = null)
                                },
                                items = state.needsOrganizing,
                                actionLabel = stringResource(R.string.inbox_action_organize),
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
                                title = stringResource(R.string.inbox_failed_title),
                                subtitle = stringResource(R.string.inbox_failed_subtitle),
                                tone = ClawTone.Error,
                                icon = {
                                    Icon(Icons.Default.Refresh, contentDescription = null)
                                },
                                items = state.failed,
                                actionLabel = stringResource(R.string.inbox_action_retry),
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
                                title = stringResource(R.string.inbox_empty_title),
                                description = stringResource(R.string.inbox_empty_description),
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
                        .padding(12.dp)
                        .align(Alignment.BottomCenter),
                ) {
                    Text(localizedErrorMessage(error))
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
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            text = if (totalItems == 0) {
                stringResource(R.string.inbox_nothing_waiting)
            } else {
                pluralStringResource(R.plurals.inbox_items_need_attention, totalItems, totalItems)
            },
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.SemiBold,
        )
        val planningSummary = pluralStringResource(
            R.plurals.inbox_summary_planning,
            planningNow,
            planningNow,
        )
        val reviewSummary = pluralStringResource(
            R.plurals.inbox_summary_review,
            reviewSuggestion,
            reviewSuggestion,
        )
        val failedSummary = pluralStringResource(
            R.plurals.inbox_summary_failed,
            failed,
            failed,
        )
        Text(
            text = stringResource(
                R.string.inbox_summary_format,
                planningSummary,
                reviewSummary,
                failedSummary,
            ),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
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
    ClawListSection(
        tone = tone,
        header = {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier = Modifier.size(32.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    icon()
                }
                ClawSectionHeader(
                    modifier = Modifier.weight(1f),
                    title = title,
                    subtitle = subtitle,
                    count = items.size,
                )
            }
        },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
            items.forEach { todo ->
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
    ClawListItemSurface(onClick = onClick) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.Top,
            ) {
                if (showSpinner) {
                    ClawStatusChip(
                        text = stringResource(R.string.inbox_state_working),
                        tone = ClawTone.Primary,
                    )
                } else {
                    ClawStatusChip(
                        text = when {
                            isError -> stringResource(R.string.inbox_state_attention)
                            todo.inboxState == "plan_ready" -> stringResource(R.string.inbox_state_suggestion)
                            else -> stringResource(R.string.inbox_state_captured)
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
