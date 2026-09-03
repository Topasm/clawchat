package com.clawchat.android.widget.common

import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.intPreferencesKey

/**
 * How far ahead the tracking widget looks for deadlines.
 *
 * A week is the span a person can still act on: long enough that a deadline
 * appears while there is room to work towards it, short enough that the widget
 * stays a glance surface rather than a backlog.
 */
internal const val DEFAULT_WIDGET_HORIZON_DAYS = 7

internal const val MIN_WIDGET_HORIZON_DAYS = 1
internal const val MAX_WIDGET_HORIZON_DAYS = 30

internal val WidgetHorizonDaysKey = intPreferencesKey("widget_horizon_days")

internal fun widgetHorizonDays(preferences: Preferences): Int =
    preferences[WidgetHorizonDaysKey]?.let(::coerceHorizonDays) ?: DEFAULT_WIDGET_HORIZON_DAYS

internal fun coerceHorizonDays(days: Int): Int =
    days.coerceIn(MIN_WIDGET_HORIZON_DAYS, MAX_WIDGET_HORIZON_DAYS)
