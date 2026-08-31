package com.clawchat.android.widget.tracking

import android.content.Context
import androidx.glance.GlanceId
import androidx.glance.action.ActionParameters
import androidx.glance.appwidget.action.ActionCallback
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.TodoUpdate
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.widget.common.WidgetUpdater
import com.clawchat.android.widget.di.WidgetEntryPoint
import dagger.hilt.android.EntryPointAccessors

/**
 * A widget checkbox is a one-way "done" action, not a status toggle.
 * Replaying the same callback therefore produces the same server state.
 */
class CompleteTodoAction : ActionCallback {
    override suspend fun onAction(
        context: Context,
        glanceId: GlanceId,
        parameters: ActionParameters,
    ) {
        val todoId = parameters[TodoTrackingWidget.TODO_ID_KEY] ?: return
        val entryPoint = EntryPointAccessors.fromApplication(
            context.applicationContext,
            WidgetEntryPoint::class.java,
        )
        val handler = TodoCompletionActionHandler { id, update ->
            entryPoint.todoRepository().updateTodo(id, update) is ApiResult.Success
        }

        handler.complete(todoId)
        WidgetUpdater.updateAll(context)
    }
}

internal class TodoCompletionActionHandler(
    private val updateTodo: suspend (String, TodoUpdate) -> Boolean,
) {
    suspend fun complete(todoId: String): Boolean {
        if (todoId.isBlank()) return false
        return updateTodo(todoId, TodoUpdate(status = TaskStatus.COMPLETED))
    }
}
