package com.clawchat.android.widget.common

import android.os.Build
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.glance.ColorFilter
import androidx.glance.GlanceModifier
import androidx.glance.ImageProvider
import androidx.glance.appwidget.cornerRadius
import androidx.glance.background
import androidx.glance.color.ColorProvider
import com.clawchat.android.widget.R

@Composable
fun GlanceModifier.widgetBackground(backgroundOpacity: Float): GlanceModifier {
    val opacity = backgroundOpacity.coerceIn(0f, 1f)
    val backgroundColor = ColorProvider(
        day = Color(0xFFF7F8FA).copy(alpha = opacity),
        night = Color(0xFF181B1F).copy(alpha = opacity),
    )

    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        this.background(backgroundColor)
            .cornerRadius(24.dp)
    } else {
        this.background(
            imageProvider = ImageProvider(R.drawable.widget_rounded_background),
            colorFilter = ColorFilter.tint(backgroundColor),
        )
    }
}
