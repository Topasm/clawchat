package com.clawchat.android.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import com.clawchat.android.core.ui.theme.AccentColor

// ClawChat brand colors
private val ClawPrimary = Color(0xFF6C5CE7)
private val ClawSecondary = Color(0xFF00B894)

private val LightColorScheme = lightColorScheme(
    primary = ClawPrimary,
    secondary = ClawSecondary,
)

private val DarkColorScheme = darkColorScheme(
    primary = ClawPrimary,
    secondary = ClawSecondary,
)

@Composable
fun ClawChatTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    accentColorKey: String = "system",
    content: @Composable () -> Unit,
) {
    val accent = AccentColor.fromKey(accentColorKey)

    val colorScheme = when {
        // "System" with dynamic color support → use wallpaper-derived theme
        accent == AccentColor.System && dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        // "System" without dynamic color → brand purple fallback
        accent == AccentColor.System -> {
            if (darkTheme) DarkColorScheme else LightColorScheme
        }
        // Custom accent → override primary on base scheme
        else -> {
            val base = if (darkTheme) DarkColorScheme else LightColorScheme
            val primary = Color(if (darkTheme) accent.darkPrimary else accent.lightPrimary)
            base.copy(primary = primary)
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        content = content,
    )
}
