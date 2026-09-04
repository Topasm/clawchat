package com.clawchat.android.widget.common

import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.intPreferencesKey

// Existing widgets stay visually unchanged until their owner chooses transparency.
internal const val DEFAULT_WIDGET_BACKGROUND_OPACITY = 100

internal val WidgetBackgroundOpacityKey = intPreferencesKey("widget_background_opacity")

internal data class WidgetAppearance(
    val backgroundOpacityPercent: Int = DEFAULT_WIDGET_BACKGROUND_OPACITY,
) {
    val backgroundOpacity: Float
        get() = backgroundOpacityPercent.coerceIn(0, 100) / 100f

    val backgroundTransparencyPercent: Int
        get() = 100 - backgroundOpacityPercent.coerceIn(0, 100)

    companion object {
        fun from(preferences: Preferences): WidgetAppearance =
            WidgetAppearance(
                backgroundOpacityPercent = preferences[WidgetBackgroundOpacityKey]
                    ?.coerceIn(0, 100)
                    ?: DEFAULT_WIDGET_BACKGROUND_OPACITY,
            )

        fun fromTransparency(transparencyPercent: Int): WidgetAppearance =
            WidgetAppearance(
                backgroundOpacityPercent = 100 - transparencyPercent.coerceIn(0, 100),
            )
    }
}
