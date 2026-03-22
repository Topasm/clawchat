package com.clawchat.android.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

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
    content: @Composable () -> Unit,
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }

    MaterialTheme(
        colorScheme = colorScheme,
        content = content,
    )
}
