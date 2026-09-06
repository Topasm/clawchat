package com.clawchat.android.feature.tasks

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.data.repository.TodoRepository
import com.clawchat.android.core.network.ApiResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

data class TaskStepsState(
    val items: List<Todo> = emptyList(),
    val draft: String = "",
    val loading: Boolean = false,
    val saving: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class TaskStepsViewModel @Inject constructor(
    private val repository: TodoRepository,
    private val savedState: SavedStateHandle,
) : ViewModel() {
    private val states = MutableStateFlow<Map<String, TaskStepsState>>(emptyMap())
    val steps = states.asStateFlow()
    private fun restored(id: String) = TaskStepsState(draft = savedState["step:$id"] ?: "")
    private fun current(id: String) = states.value[id] ?: restored(id)
    private fun update(id: String, change: (TaskStepsState) -> TaskStepsState) {
        states.update { snapshot -> snapshot + (id to change(snapshot[id] ?: restored(id))) }
    }

    fun edit(id: String, text: String) {
        if (current(id).saving) return
        if (text != current(id).draft) savedState.remove<String>("step-key:$id")
        savedState["step:$id"] = text
        update(id) { it.copy(draft = text, error = null) }
    }

    fun load(id: String) {
        if (current(id).loading || current(id).saving) return
        update(id) { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            val items = mutableListOf<Todo>()
            var page = 1
            while (true) {
                when (val result = repository.listTodos(mapOf("parent_id" to id, "page" to page.toString(), "limit" to "200"))) {
                    is ApiResult.Success -> {
                        items.addAll(result.data.items)
                        if (result.data.items.isEmpty() || items.size >= result.data.total) break
                        page++
                    }
                    is ApiResult.Error -> {
                        update(id) { it.copy(loading = false, error = result.message) }
                        return@launch
                    }
                    ApiResult.Loading -> {
                        update(id) { it.copy(loading = false, error = "Request did not complete") }
                        return@launch
                    }
                }
            }
            update(id) { it.copy(loading = false, items = items.filter { task -> task.parentId == id }.distinctBy { task -> task.id }) }
        }
    }

    fun add(parent: Todo) {
        val before = current(parent.id)
        val title = before.draft.trim()
        if (before.loading || before.saving || title.isBlank()) return
        val key = savedState.get<String>("step-key:${parent.id}") ?: UUID.randomUUID().toString().also {
            savedState["step-key:${parent.id}"] = it
        }
        update(parent.id) { it.copy(saving = true, error = null) }
        viewModelScope.launch {
            val result = repository.createTodo(TodoCreate(
                title = title, parentId = parent.id, projectId = parent.projectId,
                source = "android_app", inboxState = "none", idempotencyKey = key,
            ))
            when (result) {
                is ApiResult.Success -> {
                    savedState["step:${parent.id}"] = ""
                    savedState.remove<String>("step-key:${parent.id}")
                    update(parent.id) { it.copy(saving = false, draft = "", items = (it.items + result.data).distinctBy { task -> task.id }) }
                }
                is ApiResult.Error -> update(parent.id) { it.copy(saving = false, error = result.message) }
                ApiResult.Loading -> update(parent.id) { it.copy(saving = false, error = "Request did not complete") }
            }
        }
    }
}
