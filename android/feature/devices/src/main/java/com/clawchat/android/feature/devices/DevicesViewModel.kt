package com.clawchat.android.feature.devices

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.data.model.DataSource
import com.clawchat.android.core.data.model.DataSourceQueryResult
import com.clawchat.android.core.data.repository.DataSourceRepository
import com.clawchat.android.core.network.ApiResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** What the browser is showing inside the selected source. */
sealed interface DevicesView {
    val path: String

    data class Folder(override val path: String) : DevicesView
    data class File(override val path: String) : DevicesView
    data class Search(override val path: String, val query: String) : DevicesView
}

/** Why a request could not be answered, in terms the screen can explain. */
sealed interface DevicesError {
    /** The machine is off; a file's contents exist nowhere else. */
    data object Offline : DevicesError

    /** The machine did not answer in time. */
    data object Timeout : DevicesError

    /** That part of the folder is not shared. */
    data object NotShared : DevicesError

    data object NotFound : DevicesError

    data class Other(val message: String) : DevicesError
}

data class DevicesUiState(
    val sources: List<DataSource> = emptyList(),
    val isLoadingSources: Boolean = true,
    val sourcesError: String? = null,
    val selectedSourceId: String? = null,
    val view: DevicesView = DevicesView.Folder(""),
    val result: DataSourceQueryResult? = null,
    val isLoading: Boolean = false,
    val error: DevicesError? = null,
    val searchText: String = "",
) {
    val selectedSource: DataSource?
        get() = sources.firstOrNull { it.id == selectedSourceId }
}

internal fun parentOf(path: String): String =
    path.substringBeforeLast('/', missingDelimiterValue = "")

internal fun ApiResult.Error.toDevicesError(): DevicesError = when {
    serverCode == "DATA_SOURCE_OFFLINE" -> DevicesError.Offline
    serverCode == "DATA_SOURCE_TIMEOUT" -> DevicesError.Timeout
    serverCode == "FORBIDDEN" || code == 403 -> DevicesError.NotShared
    serverCode == "NOT_FOUND" || code == 404 -> DevicesError.NotFound
    else -> DevicesError.Other(message)
}

@HiltViewModel
class DevicesViewModel @Inject constructor(
    private val repository: DataSourceRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(DevicesUiState())
    val uiState: StateFlow<DevicesUiState> = _uiState.asStateFlow()

    private var requestJob: Job? = null

    init {
        refreshSources()
    }

    fun refreshSources() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingSources = true, sourcesError = null) }
            when (val result = repository.listSources()) {
                is ApiResult.Success -> {
                    val sources = result.data
                    val keep = _uiState.value.selectedSourceId?.takeIf { id ->
                        sources.any { it.id == id }
                    }
                    _uiState.update {
                        it.copy(sources = sources, isLoadingSources = false, sourcesError = null)
                    }
                    val selected = keep ?: sources.firstOrNull()?.id
                    if (selected != null && selected != keep) selectSource(selected)
                }
                is ApiResult.Error -> _uiState.update {
                    it.copy(isLoadingSources = false, sourcesError = result.message)
                }
                is ApiResult.Loading -> Unit
            }
        }
    }

    fun selectSource(sourceId: String) {
        _uiState.update {
            it.copy(selectedSourceId = sourceId, searchText = "", result = null, error = null)
        }
        open(DevicesView.Folder(""))
    }

    fun openFolder(path: String) = open(DevicesView.Folder(path))

    fun openFile(path: String) = open(DevicesView.File(path))

    fun onSearchTextChange(text: String) {
        _uiState.update { it.copy(searchText = text) }
    }

    fun submitSearch() {
        val text = _uiState.value.searchText.trim()
        if (text.isEmpty()) return
        val view = _uiState.value.view
        val folder = if (view is DevicesView.File) parentOf(view.path) else view.path
        open(DevicesView.Search(folder, text))
    }

    /**
     * Step back inside the source. Returns false at the top, where back
     * should leave the screen instead.
     */
    fun goUp(): Boolean {
        val view = _uiState.value.view
        return when {
            view is DevicesView.File -> {
                openFolder(parentOf(view.path))
                true
            }
            view is DevicesView.Search -> {
                openFolder(view.path)
                true
            }
            view.path.isNotEmpty() -> {
                openFolder(parentOf(view.path))
                true
            }
            else -> false
        }
    }

    fun retry() = open(_uiState.value.view)

    private fun open(view: DevicesView) {
        val sourceId = _uiState.value.selectedSourceId ?: return
        requestJob?.cancel()
        _uiState.update { it.copy(view = view, isLoading = true, error = null, result = null) }
        requestJob = viewModelScope.launch {
            val result = when (view) {
                is DevicesView.Folder -> repository.list(sourceId, view.path)
                is DevicesView.File -> repository.read(sourceId, view.path)
                is DevicesView.Search -> repository.search(sourceId, view.path, view.query)
            }
            when (result) {
                is ApiResult.Success -> _uiState.update {
                    it.copy(result = result.data, isLoading = false, error = null)
                }
                is ApiResult.Error -> _uiState.update {
                    it.copy(result = null, isLoading = false, error = result.toDevicesError())
                }
                is ApiResult.Loading -> Unit
            }
        }
    }
}
