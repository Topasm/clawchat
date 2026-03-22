package com.clawchat.android.widget.tracking

import android.content.Context
import androidx.glance.GlanceId
import androidx.glance.action.ActionParameters
import androidx.glance.appwidget.action.ActionCallback
import com.clawchat.android.core.data.model.TodoUpdate
import com.clawchat.android.widget.di.WidgetEntryPoint
import dagger.hilt.android.EntryPointAccessors

class ToggleTodoAction : ActionCallback {
    override suspend fun onAction(
        context: Context,
        glanceId: GlanceId,
        parameters: ActionParameters,
    ) {
        val todoId = parameters[TodoTrackingWidget.TODO_ID_KEY] ?: return
        val currentStatus = parameters[TodoTrackingWidget.CURRENT_STATUS_KEY] ?: return
        val newStatus = if (currentStatus == "completed") "pending" else "completed"

        val entryPoint = EntryPointAccessors.fromApplication(
            context.applicationContext,
            WidgetEntryPoint::class.java,
        )
        entryPoint.todoRepository().updateTodo(todoId, TodoUpdate(status = newStatus))

        TodoTrackingWidget().update(context, glanceId)
    }
}
