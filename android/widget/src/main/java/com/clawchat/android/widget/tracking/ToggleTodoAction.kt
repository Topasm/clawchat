package com.clawchat.android.widget.tracking

import android.content.Context
import androidx.glance.GlanceId
import androidx.glance.action.ActionParameters
import androidx.glance.appwidget.action.ActionCallback

/** Keeps already-rendered pre-upgrade widget callbacks working as a one-way done action. */
@Deprecated("Use CompleteTodoAction")
class ToggleTodoAction : ActionCallback {
    override suspend fun onAction(
        context: Context,
        glanceId: GlanceId,
        parameters: ActionParameters,
    ) {
        CompleteTodoAction().onAction(context, glanceId, parameters)
    }
}
