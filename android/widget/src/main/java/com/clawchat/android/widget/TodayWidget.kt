package com.clawchat.android.widget

import android.content.Context
import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.glance.*
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.provideContent
import androidx.glance.layout.*
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import java.time.LocalDate
import java.time.format.DateTimeFormatter

class TodayWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
        provideContent {
            TodayWidgetContent(launchIntent)
        }
    }
}

@Composable
private fun TodayWidgetContent(launchIntent: Intent?) {
    val today = LocalDate.now().format(DateTimeFormatter.ofPattern("EEEE, MMM d"))

    val modifier = if (launchIntent != null) {
        GlanceModifier
            .fillMaxSize()
            .padding(16.dp)
            .background(GlanceTheme.colors.surface)
            .clickable(androidx.glance.action.actionStartActivity(launchIntent))
    } else {
        GlanceModifier
            .fillMaxSize()
            .padding(16.dp)
            .background(GlanceTheme.colors.surface)
    }

    Column(modifier = modifier,
    ) {
        Text(
            text = today,
            style = TextStyle(
                fontWeight = FontWeight.Bold,
                color = GlanceTheme.colors.onSurface,
            ),
        )

        Spacer(modifier = GlanceModifier.height(8.dp))

        Text(
            text = "Tap to open ClawChat",
            style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant),
        )
    }
}

class TodayWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = TodayWidget()
}
