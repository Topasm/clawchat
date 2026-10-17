package com.clawchat.android.core.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * Colours that carry one meaning each. Everything else on a list is grey, or
 * the primary blue when it can be tapped.
 */
@Immutable
data class ClawSemanticColors(
    /** Today: the star. */
    val today: Color,
    /** A deadline or the calendar. */
    val deadline: Color,
    /** Tasks. */
    val tasks: Color,
    /** Something is waiting for the user. */
    val needsInput: Color,
    /** Connected to Home. */
    val connected: Color,
) {
    companion object {
        val Light = ClawSemanticColors(
            today = Color(0xFFF5B301),
            deadline = Color(0xFFE5484D),
            tasks = Color(0xFF12A594),
            needsInput = Color(0xFFF59E0B),
            connected = Color(0xFF30A46C),
        )

        // Slightly lighter so each one keeps its contrast on the grey dark surface.
        val Dark = ClawSemanticColors(
            today = Color(0xFFFFC53D),
            deadline = Color(0xFFFF6369),
            tasks = Color(0xFF2EC8B5),
            needsInput = Color(0xFFFFB224),
            connected = Color(0xFF3DD68C),
        )
    }
}

/** Set by [ClawChatTheme] from the theme it resolved, not from the system setting alone. */
val LocalClawSemanticColors = staticCompositionLocalOf { ClawSemanticColors.Light }

@Composable
@ReadOnlyComposable
fun clawSemanticColors(): ClawSemanticColors = LocalClawSemanticColors.current
