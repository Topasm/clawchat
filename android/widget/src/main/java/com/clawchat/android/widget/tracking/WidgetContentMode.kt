package com.clawchat.android.widget.tracking

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.glance.GlanceId
import androidx.glance.action.ActionParameters
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.state.updateAppWidgetState

/** Which list a tracking widget shows; each widget remembers its own tab. */
internal enum class WidgetContentMode { TASKS, NOTES }

internal val WidgetContentModeKey = stringPreferencesKey("widget_content_mode")

internal fun widgetContentMode(preferences: Preferences): WidgetContentMode =
    WidgetContentMode.entries.firstOrNull { it.name == preferences[WidgetContentModeKey] }
        ?: WidgetContentMode.TASKS

class SwitchWidgetContentAction : ActionCallback {
    override suspend fun onAction(
        context: Context,
        glanceId: GlanceId,
        parameters: ActionParameters,
    ) {
        val mode = parameters[MODE_KEY] ?: return
        updateAppWidgetState(context, glanceId) { it[WidgetContentModeKey] = mode }
        TodoTrackingWidget().update(context, glanceId)
    }

    companion object {
        val MODE_KEY = ActionParameters.Key<String>("contentMode")
    }
}
