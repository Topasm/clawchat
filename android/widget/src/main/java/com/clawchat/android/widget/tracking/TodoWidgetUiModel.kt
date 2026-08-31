package com.clawchat.android.widget.tracking

import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.TodayResponse
import com.clawchat.android.core.data.model.Todo

/** Small, deterministic projection used by the Glance UI. */
internal data class TodoWidgetUiModel(
    val overdue: List<TodoWidgetItem>,
    val today: List<TodoWidgetItem>,
) {
    val itemCount: Int
        get() = overdue.size + today.size

    val isEmpty: Boolean
        get() = itemCount == 0

    companion object {
        fun from(response: TodayResponse): TodoWidgetUiModel {
            val seenIds = mutableSetOf<String>()

            fun List<Todo>.toWidgetItems(isOverdue: Boolean): List<TodoWidgetItem> =
                asSequence()
                    .filter { it.status == TaskStatus.PENDING || it.status == TaskStatus.IN_PROGRESS }
                    .filter { seenIds.add(it.id) }
                    .map { todo ->
                        TodoWidgetItem(
                            id = todo.id,
                            title = todo.title,
                            isOverdue = isOverdue,
                            isHighPriority = todo.priority == "high" || todo.priority == "urgent",
                        )
                    }
                    .toList()

            // A malformed response can contain the same task in both buckets.
            // Prefer overdue so the more urgent placement wins.
            val overdue = response.overdueTodos.toWidgetItems(isOverdue = true)
            val today = response.todayTodos.toWidgetItems(isOverdue = false)
            return TodoWidgetUiModel(overdue = overdue, today = today)
        }
    }
}

internal data class TodoWidgetItem(
    val id: String,
    val title: String,
    val isOverdue: Boolean,
    val isHighPriority: Boolean,
)
