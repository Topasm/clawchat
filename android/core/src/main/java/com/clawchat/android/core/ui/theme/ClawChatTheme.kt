package com.clawchat.android.core.ui.theme

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.os.Build
import android.view.Window
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// Most of the screen is grey; colour is kept for meaning. Dark is grey, not
// black, so surfaces part by brightness instead of lines.
private val ClawPrimary = Color(0xFF3A82F7)
private val ClawSecondary = Color(0xFF2F9A5F)
private val ClawTertiary = Color(0xFFA86F00)

private val LightColorScheme = lightColorScheme(
    primary = ClawPrimary,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE2EDFE),
    onPrimaryContainer = Color(0xFF2F6FE0),
    secondary = ClawSecondary,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFE2F3E9),
    onSecondaryContainer = Color(0xFF1F6B42),
    tertiary = ClawTertiary,
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFF7EBD2),
    onTertiaryContainer = Color(0xFF6B4700),
    background = Color.White,
    onBackground = Color(0xFF1D1D1F),
    surface = Color.White,
    onSurface = Color(0xFF1D1D1F),
    onSurfaceVariant = Color(0xFF6E6E73),
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = Color(0xFFF4F4F6),
    surfaceContainer = Color(0xFFF4F4F6),
    surfaceContainerHigh = Color(0xFFECECEF),
    surfaceContainerHighest = Color(0xFFE6E6EA),
    outline = Color(0xFFAEAEB2),
    outlineVariant = Color(0xFFE6E6EA),
    error = Color(0xFFD23B40),
    errorContainer = Color(0xFFFBEDEE),
    onError = Color.White,
    onErrorContainer = Color(0xFF8E1F23),
)

private val DarkColorScheme = darkColorScheme(
    primary = Color(0xFF4A8DFA),
    onPrimary = Color.White,
    primaryContainer = Color(0xFF273B5E),
    onPrimaryContainer = Color(0xFF6EA6FF),
    secondary = Color(0xFF5CC98A),
    onSecondary = Color(0xFF123A24),
    secondaryContainer = Color(0xFF24402F),
    onSecondaryContainer = Color(0xFF8ADBA9),
    tertiary = Color(0xFFF5C83A),
    onTertiary = Color(0xFF3F2E00),
    tertiaryContainer = Color(0xFF45391A),
    onTertiaryContainer = Color(0xFFF5C83A),
    background = Color(0xFF1E1E20),
    onBackground = Color(0xFFF2F2F3),
    surface = Color(0xFF1E1E20),
    onSurface = Color(0xFFF2F2F3),
    onSurfaceVariant = Color(0xFF9A9A9F),
    surfaceContainerLowest = Color(0xFF19191B),
    surfaceContainerLow = Color(0xFF19191B),
    surfaceContainer = Color(0xFF28282B),
    surfaceContainerHigh = Color(0xFF2C2C2F),
    surfaceContainerHighest = Color(0xFF38383B),
    outline = Color(0xFF6E6E73),
    outlineVariant = Color(0xFF38383B),
    error = Color(0xFFF0676B),
    errorContainer = Color(0xFF3A2626),
    onError = Color(0xFF3A0D0F),
    onErrorContainer = Color(0xFFF0676B),
)

// Typography with a slightly roomier mobile hierarchy.
private val ClawTypography = Typography(
    displayLarge = TextStyle(
        fontSize = 34.sp,
        fontWeight = FontWeight.Bold,
        lineHeight = 40.sp,
        letterSpacing = 0.sp,
    ),
    displayMedium = TextStyle(
        fontSize = 28.sp,
        fontWeight = FontWeight.Bold,
        lineHeight = 34.sp,
        letterSpacing = 0.sp,
    ),
    displaySmall = TextStyle(
        fontSize = 24.sp,
        fontWeight = FontWeight.SemiBold,
        lineHeight = 30.sp,
        letterSpacing = 0.sp,
    ),
    headlineLarge = TextStyle(
        fontSize = 28.sp,
        fontWeight = FontWeight.Bold,
        lineHeight = 34.sp,
        letterSpacing = 0.sp,
    ),
    headlineMedium = TextStyle(
        fontSize = 24.sp,
        fontWeight = FontWeight.SemiBold,
        lineHeight = 30.sp,
        letterSpacing = 0.sp,
    ),
    headlineSmall = TextStyle(
        fontSize = 22.sp,
        fontWeight = FontWeight.SemiBold,
        lineHeight = 28.sp,
        letterSpacing = 0.sp,
    ),
    titleLarge = TextStyle(
        fontSize = 19.sp,
        fontWeight = FontWeight.SemiBold,
        lineHeight = 24.sp,
        letterSpacing = 0.sp,
    ),
    titleMedium = TextStyle(
        fontSize = 15.sp,
        fontWeight = FontWeight.Medium,
        lineHeight = 22.sp,
        letterSpacing = 0.05.sp,
    ),
    titleSmall = TextStyle(
        fontSize = 14.sp,
        fontWeight = FontWeight.Medium,
        lineHeight = 20.sp,
        letterSpacing = 0.1.sp,
    ),
    bodyLarge = TextStyle(
        fontSize = 15.sp,
        fontWeight = FontWeight.Normal,
        lineHeight = 22.sp,
        letterSpacing = 0.1.sp,
    ),
    bodyMedium = TextStyle(
        fontSize = 14.sp,
        fontWeight = FontWeight.Normal,
        lineHeight = 20.sp,
        letterSpacing = 0.15.sp,
    ),
    bodySmall = TextStyle(
        fontSize = 12.sp,
        fontWeight = FontWeight.Normal,
        lineHeight = 18.sp,
        letterSpacing = 0.4.sp,
    ),
    labelLarge = TextStyle(
        fontSize = 14.sp,
        fontWeight = FontWeight.Medium,
        lineHeight = 20.sp,
        letterSpacing = 0.1.sp,
    ),
    labelMedium = TextStyle(
        fontSize = 12.sp,
        fontWeight = FontWeight.Medium,
        lineHeight = 16.sp,
        letterSpacing = 0.5.sp,
    ),
    labelSmall = TextStyle(
        fontSize = 11.sp,
        fontWeight = FontWeight.Medium,
        lineHeight = 16.sp,
        letterSpacing = 0.5.sp,
    ),
)

// Shapes shared with the desktop design language: rows and controls are only
// gently rounded, and the larger radii are reserved for transient surfaces
// such as dialogs and sheets.
private val ClawShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(14.dp),
    extraLarge = RoundedCornerShape(18.dp),
)

@Composable
fun ClawChatTheme(
    themeModeKey: String = "light",
    dynamicColor: Boolean = false,
    accentColorKey: String = "system",
    content: @Composable () -> Unit,
) {
    val accent = AccentColor.fromKey(accentColorKey)
    val themeMode = ThemeMode.fromKey(themeModeKey)
    val darkTheme = when (themeMode) {
        ThemeMode.Light -> false
        ThemeMode.Dark -> true
        ThemeMode.System -> isSystemInDarkTheme()
    }

    val colorScheme = when {
        accent == AccentColor.System && dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        accent == AccentColor.System -> {
            if (darkTheme) DarkColorScheme else LightColorScheme
        }
        else -> {
            val base = if (darkTheme) DarkColorScheme else LightColorScheme
            val primary = Color(if (darkTheme) accent.darkPrimary else accent.lightPrimary)
            // Selected tabs and icon circles use the container pair; derive it
            // from the accent too, or they stay blue beside an orange accent.
            base.copy(
                primary = primary,
                primaryContainer = primary
                    .copy(alpha = if (darkTheme) 0.28f else 0.14f)
                    .compositeOver(base.surface),
                onPrimaryContainer = if (darkTheme) primary else Color(accent.lightPrimary),
            )
        }
    }

    // The clock and system icons in the status bar are painted by the system,
    // not by Compose. Left alone they follow the device's dark-mode setting
    // while the app paints its own choice behind them, so a light app on a
    // dark-mode device (or the reverse) hides them entirely. They have to be
    // told which way this theme actually resolved.
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = view.context.findActivityWindow() ?: return@SideEffect
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = !darkTheme
                isAppearanceLightNavigationBars = !darkTheme
            }
        }
    }

    CompositionLocalProvider(
        LocalClawSemanticColors provides if (darkTheme) ClawSemanticColors.Dark else ClawSemanticColors.Light,
    ) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = ClawTypography,
            shapes = ClawShapes,
            content = content,
        )
    }
}

/** Compose sees a themed wrapper, so the activity is found by unwrapping it. */
private tailrec fun Context.findActivityWindow(): Window? = when (this) {
    is Activity -> window
    is ContextWrapper -> baseContext.findActivityWindow()
    else -> null
}
