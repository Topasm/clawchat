package com.clawchat.android.feature.search

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.data.model.SearchHit
import com.clawchat.android.core.data.repository.SearchRepository
import com.clawchat.android.core.data.repository.SearchType
import com.clawchat.android.core.network.ApiResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Typing pause before a query is sent, so one word is not four requests. */
private const val QUERY_DEBOUNCE_MILLIS = 300L

data class SearchUiState(
    val query: String = "",
    val activeTypes: Set<SearchType> = emptySet(),
    val hits: List<SearchHit> = emptyList(),
    val isSearching: Boolean = false,
    /** True once a query has run, so "no results" is distinguishable from "not asked yet". */
    val hasSearched: Boolean = false,
    val error: String? = null,
) {
    /** Hits in the order the server ranked them, grouped under their type. */
    val grouped: List<Pair<SearchType, List<SearchHit>>>
        get() = SearchType.entries.mapNotNull { type ->
            hits.filter { it.type == type.hitValue }
                .takeIf { it.isNotEmpty() }
                ?.let { type to it }
        }
}

@HiltViewModel
class SearchViewModel @Inject constructor(
    private val searchRepository: SearchRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(SearchUiState())
    val uiState: StateFlow<SearchUiState> = _uiState.asStateFlow()

    private var searchJob: Job? = null

    fun onQueryChange(query: String) {
        _uiState.update { it.copy(query = query) }
        scheduleSearch()
    }

    /** Toggles one type filter; no filter means every type. */
    fun toggleType(type: SearchType) {
        _uiState.update { state ->
            val next = if (type in state.activeTypes) {
                state.activeTypes - type
            } else {
                state.activeTypes + type
            }
            state.copy(activeTypes = next)
        }
        scheduleSearch(immediate = true)
    }

    fun clearQuery() {
        searchJob?.cancel()
        _uiState.update {
            it.copy(query = "", hits = emptyList(), hasSearched = false, isSearching = false, error = null)
        }
    }

    fun retry() = scheduleSearch(immediate = true)

    private fun scheduleSearch(immediate: Boolean = false) {
        // A newer query always wins: the in-flight one is abandoned rather
        // than allowed to overwrite fresher results.
        searchJob?.cancel()
        val state = _uiState.value
        if (state.query.isBlank()) {
            _uiState.update {
                it.copy(hits = emptyList(), isSearching = false, hasSearched = false, error = null)
            }
            return
        }
        searchJob = viewModelScope.launch {
            if (!immediate) delay(QUERY_DEBOUNCE_MILLIS)
            _uiState.update { it.copy(isSearching = true, error = null) }
            when (val result = searchRepository.search(state.query, state.activeTypes)) {
                is ApiResult.Success -> _uiState.update {
                    it.copy(
                        hits = result.data,
                        isSearching = false,
                        hasSearched = true,
                        error = null,
                    )
                }

                is ApiResult.Error -> _uiState.update {
                    it.copy(
                        hits = emptyList(),
                        isSearching = false,
                        hasSearched = true,
                        error = result.message,
                    )
                }

                is ApiResult.Loading -> Unit
            }
        }
    }
}
