package com.clawchat.android.widget.common

import androidx.datastore.preferences.core.mutablePreferencesOf
import org.junit.Assert.assertEquals
import org.junit.Test

class WidgetAppearanceTest {
    @Test
    fun `defaults to the existing solid background`() {
        val appearance = WidgetAppearance.from(mutablePreferencesOf())

        assertEquals(100, appearance.backgroundOpacityPercent)
        assertEquals(0, appearance.backgroundTransparencyPercent)
        assertEquals(1f, appearance.backgroundOpacity)
    }

    @Test
    fun `stored opacity is clamped before rendering`() {
        val tooLow = mutablePreferencesOf(WidgetBackgroundOpacityKey to -20)
        val tooHigh = mutablePreferencesOf(WidgetBackgroundOpacityKey to 140)

        assertEquals(0, WidgetAppearance.from(tooLow).backgroundOpacityPercent)
        assertEquals(100, WidgetAppearance.from(tooHigh).backgroundOpacityPercent)
    }

    @Test
    fun `transparency selection converts to background opacity`() {
        val appearance = WidgetAppearance.fromTransparency(65)

        assertEquals(35, appearance.backgroundOpacityPercent)
        assertEquals(65, appearance.backgroundTransparencyPercent)
        assertEquals(0.35f, appearance.backgroundOpacity)
    }
}
