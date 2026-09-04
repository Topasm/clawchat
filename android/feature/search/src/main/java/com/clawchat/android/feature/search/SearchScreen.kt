package com.clawchat.android.feature.search

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.clawchat.android.core.data.model.SearchHit
import com.clawchat.android.core.data.repository.SearchType
import com.clawchat.android.core.ui.ClawEmptyState
import com.clawchat.android.core.ui.ClawListItemSurface
import com.clawchat.android.core.ui.ClawSectionHeader
import com.clawchat.android.core.ui.ClawStatusChip
import com.clawchat.android.core.ui.ClawTone
import com.clawchat.android.core.ui.ClawTopBarColors
import com.clawchat.android.core.ui.localizedErrorMessage

enum class QuickFindDestination {
    NOW,
    IN_PROGRESS,
    SCHEDULE,
    CHAT,
    SETTINGS,
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchScreen(
    onBack: () -> Unit = {},
    onOpenHit: (SearchHit) -> Unit = {},
    quickDestinations: List<QuickFindDestination> = QuickFindDestination.entries,
    onOpenDestination: (QuickFindDestination) -> Unit = {},
    availableTypes: List<SearchType> = SearchType.entries,
    viewModel: SearchViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val focusRequester = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current

    LaunchedEffect(Unit) { focusRequester.requestFocus() }
    LaunchedEffect(availableTypes) { viewModel.setAvailableTypes(availableTypes) }

    val supportsMessages = SearchType.Messages in availableTypes
    val destinationLabels = quickDestinations.associateWith { it.localizedLabel() }
    val matchingDestinations = destinationLabels.filterValues { label ->
        state.query.isBlank() || label.contains(state.query.trim(), ignoreCase = true)
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        stringResource(R.string.search_title),
                        fontWeight = FontWeight.SemiBold,
                        style = MaterialTheme.typography.titleLarge,
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.search_cd_back),
                        )
                    }
                },
                colors = ClawTopBarColors(),
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(
                value = state.query,
                onValueChange = viewModel::onQueryChange,
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(focusRequester),
                placeholder = {
                    Text(
                        stringResource(
                            if (supportsMessages) {
                                R.string.search_placeholder
                            } else {
                                R.string.search_placeholder_local
                            },
                        ),
                    )
                },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                trailingIcon = {
                    if (state.query.isNotEmpty()) {
                        IconButton(onClick = viewModel::clearQuery) {
                            Icon(
                                Icons.Default.Close,
                                contentDescription = stringResource(R.string.search_cd_clear_query),
                            )
                        }
                    }
                },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { keyboard?.hide() }),
            )

            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                availableTypes.forEach { type ->
                    FilterChip(
                        selected = type in state.activeTypes,
                        onClick = { viewModel.toggleType(type) },
                        label = { Text(type.localizedLabel()) },
                    )
                }
            }

            if (matchingDestinations.isNotEmpty()) {
                Text(
                    text = stringResource(R.string.search_quick_destinations),
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(
                        items = matchingDestinations.entries.toList(),
                        key = { it.key.name },
                    ) { (destination, label) ->
                        AssistChip(
                            onClick = { onOpenDestination(destination) },
                            label = { Text(label) },
                        )
                    }
                }
            }

            when {
                state.isSearching && state.hits.isEmpty() -> LoadingRow()

                state.error != null -> ClawStatusChip(
                    text = localizedErrorMessage(state.error.orEmpty()),
                    tone = ClawTone.Error,
                )

                state.hasSearched && state.hits.isEmpty() && matchingDestinations.isEmpty() -> ClawEmptyState(
                    title = stringResource(R.string.search_no_matches_title),
                    description = stringResource(R.string.search_no_matches_description, state.query),
                )

                state.hasSearched && state.hits.isEmpty() -> Unit

                !state.hasSearched -> ClawEmptyState(
                    title = stringResource(R.string.search_initial_title),
                    description = stringResource(
                        if (supportsMessages) {
                            R.string.search_initial_description
                        } else {
                            R.string.search_initial_description_local
                        },
                    ),
                )

                else -> ResultList(state = state, onOpenHit = onOpenHit)
            }
        }
    }
}

@Composable
private fun QuickFindDestination.localizedLabel(): String = stringResource(
    when (this) {
        QuickFindDestination.NOW -> R.string.search_destination_now
        QuickFindDestination.IN_PROGRESS -> R.string.search_destination_in_progress
        QuickFindDestination.SCHEDULE -> R.string.search_destination_schedule
        QuickFindDestination.CHAT -> R.string.search_destination_chat
        QuickFindDestination.SETTINGS -> R.string.search_destination_settings
    },
)

@Composable
private fun LoadingRow() {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CircularProgressIndicator(modifier = Modifier.size(28.dp))
    }
}

@Composable
private fun ResultList(state: SearchUiState, onOpenHit: (SearchHit) -> Unit) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 16.dp),
        verticalArrangement = Arrangement.spacedBy(0.dp),
    ) {
        state.grouped.forEach { (type, hits) ->
            item(key = "header-${type.filterValue}") {
                ClawSectionHeader(
                    title = type.localizedLabel(),
                    count = hits.size,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                )
            }
            items(items = hits, key = { "${type.filterValue}-${it.id}" }) { hit ->
                HitRow(hit = hit, onClick = { onOpenHit(hit) })
            }
        }
    }
}

@Composable
private fun SearchType.localizedLabel(): String = when (this) {
    SearchType.Tasks -> stringResource(R.string.search_type_tasks)
    SearchType.Events -> stringResource(R.string.search_type_events)
    SearchType.Messages -> stringResource(R.string.search_type_messages)
}

@Composable
private fun HitRow(hit: SearchHit, onClick: () -> Unit) {
    ClawListItemSurface(onClick = onClick) {
        hit.title?.takeIf { it.isNotBlank() }?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium,
            )
        }
        if (hit.preview.isNotBlank()) {
            Text(
                hit.preview,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 3,
            )
        }
    }
}
