package com.clawchat.android.feature.runs

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.data.repository.CliSessionRepository
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.model.CliSession
import com.clawchat.android.core.data.model.CliSessionAction
import com.clawchat.android.core.data.model.CliSessionDetail
import com.clawchat.android.core.data.model.CliSessionList
import com.clawchat.android.core.network.ApiResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class CliSessionsState(
    val listing: CliSessionList? = null,
    val selected: CliSession? = null,
    val detail: CliSessionDetail? = null,
    val loading: Boolean = false,
    val detailLoading: Boolean = false,
    val busy: Boolean = false,
    val error: Boolean = false,
    val accepted: Boolean = false,
)

@HiltViewModel
class CliSessionsViewModel @Inject constructor(
    private val repository: CliSessionRepository,
    sessionStore: SessionStore,
) : ViewModel() {
    private val mutable = MutableStateFlow(CliSessionsState())
    val state = mutable.asStateFlow()
    private var listJob: Job? = null
    private var detailJob: Job? = null
    private var actionJob: Job? = null
    private var generation = 0L
    private var workspace: String? = null

    init {
        viewModelScope.launch {
            sessionStore.runtimeState.map { it.workspaceKey }.distinctUntilChanged().collect {
                generation++
                workspace = it
                listJob?.cancel(); detailJob?.cancel(); actionJob?.cancel()
                mutable.value = CliSessionsState()
                refresh()
            }
        }
    }

    fun refresh() {
        if (listJob?.isActive == true || mutable.value.busy) return
        val expectedWorkspace = workspace ?: return
        val expected = generation
        mutable.update { it.copy(loading = true) }
        listJob = viewModelScope.launch {
            val result = repository.list(expectedWorkspace)
            if (expected != generation) return@launch
            mutable.update {
                when (result) {
                    is ApiResult.Success -> it.copy(listing = result.data, loading = false, error = false)
                    else -> it.copy(loading = false, error = true)
                }
            }
            mutable.value.selected?.let { if (detailJob?.isActive != true) loadDetail(it) }
        }
    }

    fun select(session: CliSession?) {
        detailJob?.cancel()
        mutable.update { it.copy(selected = session, detail = null, accepted = false, detailLoading = session != null) }
        if (session == null) return
        loadDetail(session)
    }

    private fun loadDetail(session: CliSession) {
        val expectedWorkspace = workspace ?: return
        val expected = generation
        detailJob = viewModelScope.launch {
            val result = repository.detail(expectedWorkspace, session.provider, session.id)
            if (expected != generation || mutable.value.selected?.key != session.key) return@launch
            mutable.update {
                when (result) {
                    is ApiResult.Success -> it.copy(detail = result.data, detailLoading = false, error = false)
                    else -> it.copy(detailLoading = false, error = true)
                }
            }
        }
    }

    fun act(session: CliSession, action: String, message: String? = null) {
        if (mutable.value.busy) return
        val expectedWorkspace = workspace ?: return
        val expected = generation
        mutable.update { it.copy(busy = true, accepted = false, error = false) }
        actionJob = viewModelScope.launch {
            val result = repository.act(expectedWorkspace, session.provider, session.id, CliSessionAction(action, message))
            if (expected != generation) return@launch
            mutable.update { it.copy(busy = false, accepted = it.selected?.key == session.key && result is ApiResult.Success && result.data.accepted,
                error = result !is ApiResult.Success || !result.data.accepted) }
            refresh()
        }
    }
}
