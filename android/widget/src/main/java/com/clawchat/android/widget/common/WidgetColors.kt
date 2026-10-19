package com.clawchat.android.widget.common

import androidx.compose.ui.graphics.Color
import androidx.glance.color.ColorProvider

/**
 * The app's own greys and accents, light and dark. The widgets use these, not
 * GlanceTheme's colours: those follow the wallpaper (Material You), so the
 * same widget came out purple on one phone and green on another.
 */
internal object WidgetColors {
    val Ink = ColorProvider(day = Color(0xFF1D1D1F), night = Color(0xFFF2F2F3))
    val Ink2 = ColorProvider(day = Color(0xFF48484A), night = Color(0xFFC7C7CC))
    val Ink3 = ColorProvider(day = Color(0xFF6E6E73), night = Color(0xFF9A9A9F))
    /** Fields and the runway's empty track. */
    val Raised = ColorProvider(day = Color(0xFFECECEF), night = Color(0xFF2C2C2F))
    val Blue = ColorProvider(day = Color(0xFF3A82F7), night = Color(0xFF4A8DFA))
    /** Marks drawn on a blue fill. */
    val OnBlue = ColorProvider(day = Color.White, night = Color.White)
    val Red = ColorProvider(day = Color(0xFFD23B40), night = Color(0xFFF0676B))
}
