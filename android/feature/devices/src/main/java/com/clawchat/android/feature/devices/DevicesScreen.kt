package com.clawchat.android.feature.devices

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.clawchat.android.core.data.model.DataSource
import com.clawchat.android.core.data.model.DataSourceQueryResult
import com.clawchat.android.core.ui.ClawEmptyState
import com.clawchat.android.core.ui.ClawListItemSurface
import com.clawchat.android.core.ui.ClawStatusChip
import com.clawchat.android.core.ui.ClawTone
import com.clawchat.android.core.ui.ClawTopBarColors
import com.clawchat.android.core.ui.localizedErrorMessage
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/**
 * Folders other machines share through the workspace: browse, open, search.
 *
 * Each request is answered by the machine that has the folder. When it is
 * off, the workspace still lists the names it last received, and a file
 * cannot be opened because its contents are kept nowhere else.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DevicesScreen(
    onBack: () -> Unit = {},
    viewModel: DevicesViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val keyboard = LocalSoftwareKeyboardController.current

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        stringResource(R.string.devices_title),
                        fontWeight = FontWeight.SemiBold,
                        style = MaterialTheme.typography.titleLarge,
                    )
                },
                navigationIcon = {
                    IconButton(onClick = { if (!viewModel.goUp()) onBack() }) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.devices_cd_back),
                        )
                    }
                },
                actions = {
                    IconButton(onClick = viewModel::refreshSources) {
                        Icon(
                            Icons.Default.Refresh,
                            contentDescription = stringResource(R.string.devices_cd_refresh),
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
            when {
                state.isLoadingSources && state.sources.isEmpty() -> LoadingRow()

                state.sourcesError != null && state.sources.isEmpty() -> ClawStatusChip(
                    text = localizedErrorMessage(state.sourcesError.orEmpty()),
                    tone = ClawTone.Error,
                )

                state.sources.isEmpty() -> ClawEmptyState(
                    title = stringResource(R.string.devices_empty_title),
                    description = stringResource(R.string.devices_empty_description),
                )

                else -> {
                    SourcePicker(
                        sources = state.sources,
                        selectedId = state.selectedSourceId,
                        onSelect = viewModel::selectSource,
                    )
                    state.selectedSource?.let { source ->
                        SourceStatus(source)
                        if ("search" in source.capabilities) {
                            OutlinedTextField(
                                value = state.searchText,
                                onValueChange = viewModel::onSearchTextChange,
                                modifier = Modifier.fillMaxWidth(),
                                placeholder = {
                                    Text(stringResource(R.string.devices_search_placeholder, source.name))
                                },
                                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                                keyboardActions = KeyboardActions(onSearch = {
                                    keyboard?.hide()
                                    viewModel.submitSearch()
                                }),
                            )
                        }
                        Text(
                            text = "/" + state.view.path,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Browser(state = state, source = source, viewModel = viewModel)
                    }
                }
            }
        }
    }
}

@Composable
private fun SourcePicker(
    sources: List<DataSource>,
    selectedId: String?,
    onSelect: (String) -> Unit,
) {
    Row(
        modifier = Modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        sources.forEach { source ->
            FilterChip(
                selected = source.id == selectedId,
                onClick = { onSelect(source.id) },
                label = { Text("${source.name} · ${source.hostLabel}") },
            )
        }
    }
}

@Composable
private fun SourceStatus(source: DataSource) {
    if (source.isOnline) {
        ClawStatusChip(
            text = stringResource(R.string.devices_online, source.hostLabel),
            tone = ClawTone.Success,
        )
    } else {
        ClawStatusChip(text = offlineLabel(source.lastSeenAt), tone = ClawTone.Default)
    }
}

@Composable
private fun offlineLabel(lastSeenAt: String?): String {
    val time = formatTimestamp(lastSeenAt)
    return if (time != null) {
        stringResource(R.string.devices_offline_since, time)
    } else {
        stringResource(R.string.devices_offline_never)
    }
}

internal fun formatTimestamp(value: String?): String? = value?.let {
    runCatching {
        OffsetDateTime.parse(it)
            .atZoneSameInstant(ZoneId.systemDefault())
            .format(DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT))
    }.getOrNull()
}

@Composable
private fun Browser(state: DevicesUiState, source: DataSource, viewModel: DevicesViewModel) {
    val error = state.error
    val result = state.result
    when {
        state.isLoading -> Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            CircularProgressIndicator(modifier = Modifier.size(20.dp))
            Text(
                stringResource(R.string.devices_asking, source.hostLabel),
                style = MaterialTheme.typography.bodyMedium,
            )
        }

        error != null -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            ClawStatusChip(text = errorText(error, source), tone = ClawTone.Error)
            if (error is DevicesError.Timeout || error is DevicesError.Other) {
                TextButton(onClick = viewModel::retry) {
                    Text(stringResource(R.string.devices_retry))
                }
            }
        }

        result == null -> Unit

        state.view is DevicesView.File -> FileContent(result)

        else -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            CacheNotice(result, source)
            EntryList(state = state, result = result, viewModel = viewModel)
        }
    }
}

@Composable
private fun errorText(error: DevicesError, source: DataSource): String = when (error) {
    DevicesError.Offline -> stringResource(R.string.devices_error_offline, source.hostLabel)
    DevicesError.Timeout -> stringResource(R.string.devices_error_timeout, source.hostLabel)
    DevicesError.NotShared -> stringResource(R.string.devices_error_not_shared, source.name)
    DevicesError.NotFound -> stringResource(R.string.devices_error_not_found)
    is DevicesError.Other -> localizedErrorMessage(error.message)
}

@Composable
private fun CacheNotice(result: DataSourceQueryResult, source: DataSource) {
    if (result.origin != "cache") return
    val text = when {
        result.op == "search" -> stringResource(R.string.devices_cache_search, source.hostLabel)
        result.fallbackReason == "timeout" ->
            stringResource(R.string.devices_cache_timeout, source.hostLabel)
        else -> offlineLabel(result.lastSeenAt) + " · " +
            stringResource(R.string.devices_cache_offline)
    }
    ClawStatusChip(text = text, tone = ClawTone.Warning)
}

@Composable
private fun EntryList(
    state: DevicesUiState,
    result: DataSourceQueryResult,
    viewModel: DevicesViewModel,
) {
    val isSearch = state.view is DevicesView.Search
    if ((isSearch && result.matches.isEmpty()) || (!isSearch && result.entries.isEmpty())) {
        Text(
            stringResource(if (isSearch) R.string.devices_no_matches else R.string.devices_folder_empty),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        return
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 16.dp),
    ) {
        if (isSearch) {
            items(items = result.matches, key = { "${it.path}:${it.line ?: 0}" }) { match ->
                ClawListItemSurface(onClick = { viewModel.openFile(match.path) }) {
                    Text(match.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                    Text(
                        match.snippet ?: match.path,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                    )
                }
            }
        } else {
            items(items = result.entries, key = { it.path }) { entry ->
                ClawListItemSurface(
                    onClick = {
                        if (entry.isDir) viewModel.openFolder(entry.path) else viewModel.openFile(entry.path)
                    },
                ) {
                    Text(
                        if (entry.isDir) "${entry.name}/" else entry.title,
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = if (entry.isDir) FontWeight.SemiBold else FontWeight.Normal,
                    )
                    formatTimestamp(entry.modifiedAt)?.let {
                        Text(
                            it,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun FileContent(result: DataSourceQueryResult) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        result.tasks?.takeIf { it.isNotEmpty() }?.forEach { task ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = task.status == "completed", onCheckedChange = null, enabled = false)
                Text(task.title, style = MaterialTheme.typography.bodyMedium)
                task.dueDate?.let {
                    Text(
                        "  $it",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        Text(
            result.content.orEmpty(),
            style = MaterialTheme.typography.bodyMedium,
            fontFamily = FontFamily.Monospace,
        )
        if (result.truncated) {
            Text(
                stringResource(R.string.devices_file_truncated),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

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
