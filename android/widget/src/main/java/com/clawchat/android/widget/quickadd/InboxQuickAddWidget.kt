package com.clawchat.android.widget.quickadd

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.ColorFilter
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.widget.R
import com.clawchat.android.widget.common.widgetBackground
import com.clawchat.android.widget.di.WidgetEntryPoint
import dagger.hilt.android.EntryPointAccessors
import kotlinx.coroutines.flow.first

class InboxQuickAddWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val entryPoint = EntryPointAccessors.fromApplication(
            context.applicationContext,
            WidgetEntryPoint::class.java,
        )
        val token = entryPoint.sessionStore().token.first()

        val inboxCount = if (token != null) {
            when (val result = entryPoint.todayRepository().getToday()) {
                is ApiResult.Success -> result.data.inboxCount
                else -> null
            }
        } else null

        provideContent {
            GlanceTheme {
                InboxQuickAddContent(
                    isLoggedIn = token != null,
                    inboxCount = inboxCount,
                )
            }
        }
    }
}

@Composable
private fun InboxQuickAddContent(
    isLoggedIn: Boolean,
    inboxCount: Int?,
) {
    val context = LocalContext.current
    val quickAddIntent = Intent(context, QuickAddActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
    }
    val mainActivity = ComponentName(context.packageName, "com.clawchat.android.MainActivity")

    Row(
        modifier = GlanceModifier
            .fillMaxSize()
            .widgetBackground()
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Inbox icon
        Image(
            provider = ImageProvider(R.drawable.ic_widget_inbox),
            contentDescription = "Inbox",
            colorFilter = ColorFilter.tint(GlanceTheme.colors.primary),
            modifier = GlanceModifier.size(24.dp),
        )

        Spacer(GlanceModifier.width(8.dp))

        // Fake text field area — tapping opens QuickAddActivity or main app
        Box(
            modifier = GlanceModifier
                .defaultWeight()
                .then(
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        GlanceModifier.cornerRadius(12.dp)
                            .background(GlanceTheme.colors.surfaceVariant)
                    } else {
                        GlanceModifier.background(GlanceTheme.colors.surfaceVariant)
                    }
                )
                .padding(horizontal = 12.dp, vertical = 10.dp)
                .clickable(
                    if (isLoggedIn) actionStartActivity(quickAddIntent)
                    else actionStartActivity(mainActivity)
                ),
            contentAlignment = Alignment.CenterStart,
        ) {
            Text(
                text = if (isLoggedIn) "Add to inbox\u2026" else "Please log in",
                style = TextStyle(
                    color = GlanceTheme.colors.onSurfaceVariant,
                    fontSize = 14.sp,
                ),
            )
        }

        // Inbox count badge
        if (inboxCount != null && inboxCount > 0) {
            Spacer(GlanceModifier.width(8.dp))
            Box(
                modifier = GlanceModifier
                    .then(
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                            GlanceModifier.cornerRadius(12.dp)
                                .background(GlanceTheme.colors.primary)
                        } else {
                            GlanceModifier.background(GlanceTheme.colors.primary)
                        }
                    )
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = inboxCount.toString(),
                    style = TextStyle(
                        color = GlanceTheme.colors.onPrimary,
                        fontWeight = FontWeight.Bold,
                        fontSize = 12.sp,
                    ),
                )
            }
        }
    }
}
