package com.clawchat.android.widget.tracking

import android.content.Context
import androidx.glance.GlanceId
import androidx.glance.action.ActionParameters
import androidx.glance.appwidget.action.ActionCallback
import com.clawchat.android.widget.common.WidgetUpdater

class RefreshTodosAction : ActionCallback {
    override suspend fun onAction(
        context: Context,
        glanceId: GlanceId,
        parameters: ActionParameters,
    ) {
        WidgetUpdater.updateAll(context)
    }
}
