package com.clawchat.android.widget.common

import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.intPreferencesKey

/**
 * How far ahead the tracking widget looks for deadlines.
 *
 * Two weeks: a deadline appears while there is still room to work towards it,
 * and the list stays a glance surface rather than a backlog. A week left the
 * widget empty too often for someone whose next deadline was a fortnight out.
 * Only new widgets take this; one that saved a horizon keeps it.
 */
internal const val DEFAULT_WIDGET_HORIZON_DAYS = 14

internal const val MIN_WIDGET_HORIZON_DAYS = 1
internal const val MAX_WIDGET_HORIZON_DAYS = 30

internal val WidgetHorizonDaysKey = intPreferencesKey("widget_horizon_days")

internal fun widgetHorizonDays(preferences: Preferences): Int =
    preferences[WidgetHorizonDaysKey]?.let(::coerceHorizonDays) ?: DEFAULT_WIDGET_HORIZON_DAYS

internal fun coerceHorizonDays(days: Int): Int =
    days.coerceIn(MIN_WIDGET_HORIZON_DAYS, MAX_WIDGET_HORIZON_DAYS)
