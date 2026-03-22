package com.clawchat.android.widget.common

import android.os.Build
import androidx.compose.ui.unit.dp
import androidx.glance.ColorFilter
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.ImageProvider
import androidx.glance.appwidget.cornerRadius
import androidx.glance.background
import com.clawchat.android.widget.R

fun GlanceModifier.widgetBackground(): GlanceModifier =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        this.background(GlanceTheme.colors.widgetBackground)
            .cornerRadius(24.dp)
    } else {
        this.background(
            imageProvider = ImageProvider(R.drawable.widget_rounded_background),
            colorFilter = ColorFilter.tint(GlanceTheme.colors.widgetBackground),
        )
    }

fun GlanceModifier.widgetItemBackground(completed: Boolean): GlanceModifier =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        this.cornerRadius(16.dp)
            .background(
                if (!completed) GlanceTheme.colors.secondaryContainer
                else GlanceTheme.colors.tertiaryContainer
            )
    } else {
        this.background(
            imageProvider = ImageProvider(R.drawable.widget_rounded_item),
            colorFilter = ColorFilter.tint(
                if (!completed) GlanceTheme.colors.secondaryContainer
                else GlanceTheme.colors.tertiaryContainer
            ),
        )
    }
