package com.clawchat.android.feature.tasks

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.data.model.ProjectPlan
import com.clawchat.android.core.data.model.ProjectNode
import com.clawchat.android.core.data.repository.ProjectPlanRepository
import com.clawchat.android.core.data.repository.ConversationRepository
import com.clawchat.android.core.data.repository.AgentRunRepository
import com.clawchat.android.core.network.ApiResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ProjectPlanState(
    val projects: List<ProjectPlan> = emptyList(),
    val project: ProjectPlan? = null,
    val nodes: List<ProjectNode> = emptyList(),
    val taskTitles: Map<String, String> = emptyMap(),
    val loading: Boolean = false,
    val busy: Boolean = false,
    val error: String? = null,
    val openConversation: String? = null,
    val openRun: String? = null,
    val conversationTitle: String? = null,
)

@HiltViewModel
class ProjectPlanViewModel @Inject constructor(
    private val repository: ProjectPlanRepository,
    private val conversations: ConversationRepository,
    private val runs: AgentRunRepository,
) : ViewModel() {
    private val state = MutableStateFlow(ProjectPlanState())
    val uiState = state.asStateFlow()
    private var generation = 0L
    private var load: Job? = null

    init { refresh() }

    fun refresh() {
        if (state.value.busy || load?.isActive == true) return
        val selected = state.value.project
        load?.cancel()
        val token = ++generation
        state.update { it.copy(loading = true, error = null) }
        load = viewModelScope.launch {
            if (selected == null) {
                when (val result = repository.list()) {
                    is ApiResult.Success -> if (token == generation) state.update { it.copy(projects = result.data) }
                    is ApiResult.Error -> if (token == generation) state.update { it.copy(error = result.message) }
                    else -> Unit
                }
            } else {
                when (val result = repository.project(selected.id)) {
                    is ApiResult.Success -> if (token == generation) {
                        state.update { it.copy(project = result.data) }
                        result.data.rootTaskId?.let { root ->
                            when (val graph = repository.graph(root)) {
                                is ApiResult.Success -> if (token == generation) state.update {
                                    it.copy(
                                        nodes = graph.data.nodes.filter { node -> node.scopeRole == "descendant" },
                                        taskTitles = graph.data.nodes.associate { node -> node.id to node.title },
                                    )
                                }
                                is ApiResult.Error -> if (token == generation) state.update { it.copy(nodes = emptyList(), error = graph.message) }
                                else -> Unit
                            }
                        } ?: state.update { it.copy(nodes = emptyList()) }
                    }
                    is ApiResult.Error -> if (token == generation) state.update { it.copy(nodes = emptyList(), error = result.message) }
                    else -> Unit
                }
            }
            if (token == generation) state.update { it.copy(loading = false) }
        }
    }

    fun select(project: ProjectPlan?) {
        if (state.value.busy) return
        state.update { it.copy(project = project, nodes = emptyList(), taskTitles = emptyMap(), openConversation = null, openRun = null) }
        // A selection always invalidates earlier reads, including A → B → A.
        load?.cancel()
        generation++
        if (!state.value.busy) refresh()
    }

    fun discuss(taskId: String? = null) {
        val project = state.value.project ?: return
        val root = taskId ?: project.rootTaskId ?: return
        val title = if (taskId == null) project.title else "${project.title} › ${state.value.taskTitles[taskId] ?: taskId}"
        if (taskId == null && project.conversationId != null) {
            state.update { it.copy(openConversation = project.conversationId, conversationTitle = title) }
            return
        }
        mutate {
            when (val result = conversations.getOrCreateForTodo(root)) {
                is ApiResult.Success -> state.update { it.copy(openConversation = result.data.id, conversationTitle = title) }
                is ApiResult.Error -> state.update { it.copy(error = result.message) }
                else -> Unit
            }
        }
    }

    fun run(taskId: String) {
        if (state.value.loading || state.value.nodes.none { it.id == taskId && it.isReady }) return
        mutate {
            when (val result = repository.run(taskId)) {
                is ApiResult.Success -> {
                    val run = (runs.getRun(result.data.runId) as? ApiResult.Success)?.data
                    state.update { current -> current.copy(
                        openConversation = run?.conversationId,
                        conversationTitle = "${current.project?.title.orEmpty()} › ${current.taskTitles[taskId] ?: taskId}",
                        openRun = if (run?.conversationId == null) result.data.runId else null,
                        nodes = current.nodes.map { if (it.id == taskId) it.copy(isReady = false, executionState = "in_progress") else it },
                    ) }
                }
                is ApiResult.Error -> state.update { it.copy(error = result.message) }
                else -> Unit
            }
        }
    }

    private fun mutate(action: suspend () -> Unit) {
        if (state.value.busy) return
        state.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try { action() } finally { state.update { it.copy(busy = false) } }
        }
    }

    fun navigationConsumed() { state.update { it.copy(openConversation = null, openRun = null) } }
}

/** Parent links, not dependency links, determine outline indentation. Safe for malformed cycles. */
internal fun projectOutline(nodes: List<ProjectNode>): List<Pair<ProjectNode, Int>> {
    val byParent = nodes.groupBy { it.parentId }
    val ids = nodes.map { it.id }.toSet()
    val seen = mutableSetOf<String>()
    val result = mutableListOf<Pair<ProjectNode, Int>>()
    fun visit(node: ProjectNode, depth: Int) {
        if (!seen.add(node.id)) return
        result += node to depth
        byParent[node.id].orEmpty().forEach { visit(it, depth + 1) }
    }
    nodes.filter { it.parentId !in ids }.forEach { visit(it, 0) }
    nodes.forEach { visit(it, 0) }
    return result
}

internal fun visibleProjectOutline(nodes: List<ProjectNode>, collapsed: Set<String>, showFinished: Boolean): List<Pair<ProjectNode, Int>> {
    val byId = nodes.associateBy { it.id }
    val needed = mutableSetOf<String>()
    for (node in nodes.filter { showFinished || it.executionState !in setOf("completed", "cancelled") }) {
        var current: ProjectNode? = node
        val visited = mutableSetOf<String>()
        while (current != null && visited.add(current.id)) {
            needed += current.id
            current = byId[current.parentId]
        }
    }
    var hiddenBelow: Int? = null
    return projectOutline(nodes).filter { (node, depth) ->
        if (hiddenBelow != null && depth <= hiddenBelow) hiddenBelow = null
        if (hiddenBelow != null) false else {
            if (node.id in collapsed) hiddenBelow = depth
            node.id in needed
        }
    }
}
