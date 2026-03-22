package com.clawchat.android.feature.inbox

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.clawchat.android.core.data.model.Todo

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InboxScreen(
    viewModel: InboxViewModel = hiltViewModel(),
    onTaskClick: (String) -> Unit = {},
) {
    val state by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(title = { Text("Inbox") })
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = state.isRefreshing,
            onRefresh = viewModel::refresh,
            modifier = Modifier.padding(padding),
        ) {
            if (state.isLoading) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator()
                }
            } else if (isEmpty(state)) {
                // Empty state
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            Icons.Default.CheckCircle,
                            contentDescription = null,
                            modifier = Modifier.size(48.dp),
                            tint = MaterialTheme.colorScheme.primary,
                        )
                        Spacer(Modifier.height(12.dp))
                        Text(
                            "Inbox is clear",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    // Planning now section
                    if (state.planningNow.isNotEmpty()) {
                        item {
                            SectionHeader("Planning now")
                        }
                        items(state.planningNow, key = { it.id }) { todo ->
                            InboxItemCard(
                                todo = todo,
                                showSpinner = true,
                                onClick = { onTaskClick(todo.id) },
                            )
                        }
                        item { Spacer(Modifier.height(8.dp)) }
                    }

                    // Review suggestion section
                    if (state.reviewSuggestion.isNotEmpty()) {
                        item {
                            SectionHeader("Review suggestion")
                        }
                        items(state.reviewSuggestion, key = { it.id }) { todo ->
                            InboxItemCard(
                                todo = todo,
                                actionLabel = "Review",
                                onAction = { viewModel.organize(todo.id) },
                                onClick = { onTaskClick(todo.id) },
                            )
                        }
                        item { Spacer(Modifier.height(8.dp)) }
                    }

                    // Needs organizing section
                    if (state.needsOrganizing.isNotEmpty()) {
                        item {
                            SectionHeader("Needs organizing")
                        }
                        items(state.needsOrganizing, key = { it.id }) { todo ->
                            InboxItemCard(
                                todo = todo,
                                actionLabel = "Organize",
                                onAction = { viewModel.organize(todo.id) },
                                onClick = { onTaskClick(todo.id) },
                            )
                        }
                        item { Spacer(Modifier.height(8.dp)) }
                    }

                    // Failed section
                    if (state.failed.isNotEmpty()) {
                        item {
                            SectionHeader("Failed")
                        }
                        items(state.failed, key = { it.id }) { todo ->
                            InboxItemCard(
                                todo = todo,
                                actionLabel = "Retry",
                                onAction = { viewModel.retryOrganize(todo.id) },
                                onClick = { onTaskClick(todo.id) },
                                isError = true,
                            )
                        }
                    }
                }
            }

            // Error snackbar
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
private fun SectionHeader(title: String) {
    Text(
        title,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
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
    ElevatedCard(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (showSpinner) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    strokeWidth = 2.dp,
                )
                Spacer(Modifier.width(12.dp))
            }

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    todo.title,
                    style = MaterialTheme.typography.bodyLarge,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                val summary = todo.planSummary
                if (!summary.isNullOrBlank()) {
                    Text(
                        summary,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                if (isError) {
                    val errorMsg = todo.automationError
                    if (!errorMsg.isNullOrBlank()) {
                        Text(
                            errorMsg,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }

            if (actionLabel != null && onAction != null) {
                Spacer(Modifier.width(8.dp))
                if (isError) {
                    FilledTonalButton(
                        onClick = onAction,
                        colors = ButtonDefaults.filledTonalButtonColors(
                            containerColor = MaterialTheme.colorScheme.errorContainer,
                            contentColor = MaterialTheme.colorScheme.onErrorContainer,
                        ),
                    ) {
                        Icon(
                            Icons.Default.Refresh,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(Modifier.width(4.dp))
                        Text(actionLabel)
                    }
                } else {
                    FilledTonalButton(onClick = onAction) {
                        Text(actionLabel)
                    }
                }
            }
        }
    }
}
