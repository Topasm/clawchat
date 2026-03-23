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
import com.clawchat.android.core.ui.theme.ThemeMode

private val ClawPrimary = Color(0xFF2F67E8)
private val ClawSecondary = Color(0xFF2D8A64)
private val ClawTertiary = Color(0xFF8B7CD9)

private val LightColorScheme = lightColorScheme(
    primary = ClawPrimary,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE7EEFF),
    onPrimaryContainer = Color(0xFF16337A),
    secondary = ClawSecondary,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFE3F4EC),
    onSecondaryContainer = Color(0xFF153728),
    tertiary = ClawTertiary,
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFF0EBFF),
    onTertiaryContainer = Color(0xFF3B2B73),
    background = Color(0xFFF4F1EC),
    onBackground = Color(0xFF201E1A),
    surface = Color(0xFFFCFAF7),
    onSurface = Color(0xFF1F1E1A),
    onSurfaceVariant = Color(0xFF706B63),
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = Color(0xFFF7F4EF),
    surfaceContainer = Color(0xFFF1EEE8),
    surfaceContainerHigh = Color(0xFFE9E5DE),
    surfaceContainerHighest = Color(0xFFE1DDD5),
    outline = Color(0xFFD1CBC2),
    outlineVariant = Color(0xFFE7E1D8),
    error = Color(0xFFBA1A1A),
    errorContainer = Color(0xFFFFDAD6),
    onError = Color.White,
    onErrorContainer = Color(0xFF410002),
)

private val DarkColorScheme = darkColorScheme(
    primary = Color(0xFFB9C9FF),
    onPrimary = Color(0xFF1B3A88),
    primaryContainer = Color(0xFF263965),
    onPrimaryContainer = Color(0xFFDDE6FF),
    secondary = Color(0xFFA3D8BF),
    onSecondary = Color(0xFF15392B),
    secondaryContainer = Color(0xFF223F34),
    onSecondaryContainer = Color(0xFFD5F2E4),
    tertiary = Color(0xFFD2C5FF),
    onTertiary = Color(0xFF453684),
    tertiaryContainer = Color(0xFF3B3357),
    onTertiaryContainer = Color(0xFFF0EAFF),
    background = Color(0xFF191817),
    onBackground = Color(0xFFF1EDE6),
    surface = Color(0xFF21201E),
    onSurface = Color(0xFFF3EFE8),
    onSurfaceVariant = Color(0xFFBEB7AD),
    surfaceContainerLowest = Color(0xFF171614),
    surfaceContainerLow = Color(0xFF262421),
    surfaceContainer = Color(0xFF2C2A27),
    surfaceContainerHigh = Color(0xFF33302D),
    surfaceContainerHighest = Color(0xFF3B3835),
    outline = Color(0xFF8B847B),
    outlineVariant = Color(0xFF494540),
    error = Color(0xFFFFB4AB),
    errorContainer = Color(0xFF93000A),
    onError = Color(0xFF690005),
    onErrorContainer = Color(0xFFFFDAD6),
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

// Shapes with mobile-friendly Material 3 rounding.
private val ClawShapes = Shapes(
    extraSmall = RoundedCornerShape(10.dp),
    small = RoundedCornerShape(14.dp),
    medium = RoundedCornerShape(18.dp),
    large = RoundedCornerShape(24.dp),
    extraLarge = RoundedCornerShape(30.dp),
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
