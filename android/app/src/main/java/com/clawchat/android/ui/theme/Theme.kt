package com.clawchat.android.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clawchat.android.core.ui.theme.AccentColor

// ── Material 3 color palette tuned for a productivity app ───────────────────
private val ClawPrimary = Color(0xFF246BFD)
private val ClawSecondary = Color(0xFF0B8F6A)
private val ClawTertiary = Color(0xFF8B5CF6)

private val LightColorScheme = lightColorScheme(
    primary = ClawPrimary,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFDCE7FF),
    onPrimaryContainer = Color(0xFF001B54),
    secondary = ClawSecondary,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFC6F1E0),
    onSecondaryContainer = Color(0xFF002117),
    tertiary = ClawTertiary,
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFE9DDFF),
    onTertiaryContainer = Color(0xFF2E145C),
    surface = Color(0xFFF7F9FD),
    onSurface = Color(0xFF161C24),
    onSurfaceVariant = Color(0xFF5C667A),
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = Color(0xFFF0F4FA),
    surfaceContainer = Color(0xFFE8EEF7),
    surfaceContainerHigh = Color(0xFFE0E7F2),
    surfaceContainerHighest = Color(0xFFD7E0EC),
    outline = Color(0xFFBAC4D5),
    outlineVariant = Color(0xFFD7DEE8),
    error = Color(0xFFBA1A1A),
    errorContainer = Color(0xFFFFDAD6),
    onError = Color.White,
    onErrorContainer = Color(0xFF410002),
)

private val DarkColorScheme = darkColorScheme(
    primary = Color(0xFFB6CBFF),
    onPrimary = Color(0xFF002E86),
    primaryContainer = Color(0xFF0042BD),
    onPrimaryContainer = Color(0xFFDEE8FF),
    secondary = Color(0xFF8FD7BB),
    onSecondary = Color(0xFF003828),
    secondaryContainer = Color(0xFF00513B),
    onSecondaryContainer = Color(0xFFABF4D6),
    tertiary = Color(0xFFD1BCFF),
    onTertiary = Color(0xFF48217C),
    tertiaryContainer = Color(0xFF5F3794),
    onTertiaryContainer = Color(0xFFEBDDFF),
    surface = Color(0xFF10141B),
    onSurface = Color(0xFFE7ECF4),
    onSurfaceVariant = Color(0xFFB6C0D1),
    surfaceContainerLowest = Color(0xFF0B0F14),
    surfaceContainerLow = Color(0xFF171C25),
    surfaceContainer = Color(0xFF1B212C),
    surfaceContainerHigh = Color(0xFF252C38),
    surfaceContainerHighest = Color(0xFF303845),
    outline = Color(0xFF8590A2),
    outlineVariant = Color(0xFF3E4655),
    error = Color(0xFFFFB4AB),
    errorContainer = Color(0xFF93000A),
    onError = Color(0xFF690005),
    onErrorContainer = Color(0xFFFFDAD6),
)

// ── Typography — slightly roomier mobile hierarchy ───────────────────────────
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
        fontSize = 20.sp,
        fontWeight = FontWeight.SemiBold,
        lineHeight = 26.sp,
        letterSpacing = 0.sp,
    ),
    titleMedium = TextStyle(
        fontSize = 16.sp,
        fontWeight = FontWeight.Medium,
        lineHeight = 24.sp,
        letterSpacing = 0.1.sp,
    ),
    titleSmall = TextStyle(
        fontSize = 14.sp,
        fontWeight = FontWeight.Medium,
        lineHeight = 20.sp,
        letterSpacing = 0.1.sp,
    ),
    bodyLarge = TextStyle(
        fontSize = 16.sp,
        fontWeight = FontWeight.Normal,
        lineHeight = 24.sp,
        letterSpacing = 0.15.sp,
    ),
    bodyMedium = TextStyle(
        fontSize = 14.sp,
        fontWeight = FontWeight.Normal,
        lineHeight = 21.sp,
        letterSpacing = 0.25.sp,
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

// ── Shapes — Material 3 mobile-friendly rounding ─────────────────────────────
private val ClawShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(24.dp),
    extraLarge = RoundedCornerShape(28.dp),
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
            base.copy(primary = primary)
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = ClawTypography,
        shapes = ClawShapes,
        content = content,
    )
}
