package com.clawchat.android.widget.preview

import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.glance.GlanceId
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.compose
import androidx.glance.appwidget.provideContent
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.clawchat.android.widget.common.WidgetState
import com.clawchat.android.widget.quickadd.InboxQuickAddContent
import com.clawchat.android.widget.tracking.NextDeadline
import com.clawchat.android.widget.tracking.TodoTrackingContent
import com.clawchat.android.widget.tracking.TodoWidgetItem
import com.clawchat.android.widget.tracking.TodoWidgetUiModel
import com.clawchat.android.widget.tracking.WidgetContentMode
import com.github.takahirom.roborazzi.captureRoboImage
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The widgets as the launcher draws them: each is composed to RemoteViews,
 * inflated, and laid on the design's grey wallpaper. Light and Korean, as
 * the design shows them, plus the list in dark.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ko-w393dp-h851dp-xxhdpi")
class WidgetScreenshotTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val mainActivity = ComponentName("com.clawchat.android", "com.clawchat.android.MainActivity")

    private val runway = TodoWidgetUiModel(
        deadlines = listOf(
            TodoWidgetItem("t1", "영어 논문 리비전", daysRemaining = -1, runwayFraction = 1f),
            TodoWidgetItem("t2", "통계 퀴즈 준비", daysRemaining = 0, runwayFraction = 1f),
            TodoWidgetItem("t3", "연구실 미팅 자료", daysRemaining = 6, runwayFraction = 0.55f),
            TodoWidgetItem("t4", "Gpu 컴퓨팅 과제", daysRemaining = 18, runwayFraction = 0.2f),
        ),
        others = listOf(
            TodoWidgetItem("t5", "ICLR 실험 표 정리", daysRemaining = null, runwayFraction = null, inProgress = true),
            TodoWidgetItem("t6", "참고 논문 찾기", daysRemaining = null, runwayFraction = null),
        ),
    )

    @Test
    fun taskList() = shot("tracking_list", DpSize(362.dp, 380.dp)) {
        TodoTrackingContent(
            state = WidgetState.Success(runway),
            contentMode = WidgetContentMode.TASKS,
            horizonDays = 14,
            mainActivity = mainActivity,
            workspaceKey = "ws",
            backgroundOpacity = 0.96f,
        )
    }

    @Test
    @Config(qualifiers = "+night")
    fun taskListDark() = shot("tracking_list_dark", DpSize(362.dp, 380.dp)) {
        TodoTrackingContent(
            state = WidgetState.Success(runway),
            contentMode = WidgetContentMode.TASKS,
            horizonDays = 14,
            mainActivity = mainActivity,
            workspaceKey = "ws",
            backgroundOpacity = 0.96f,
        )
    }

    @Test
    fun emptyTile() = shot("tracking_tile_empty", DpSize(176.dp, 115.dp)) {
        TodoTrackingContent(
            state = WidgetState.Success(
                TodoWidgetUiModel(
                    deadlines = emptyList(),
                    nextDeadline = NextDeadline("Gpu 컴퓨팅 과제", LocalDate.of(2026, 11, 3), 18),
                ),
            ),
            contentMode = WidgetContentMode.TASKS,
            horizonDays = 14,
            mainActivity = mainActivity,
            workspaceKey = "ws",
            backgroundOpacity = 0.96f,
        )
    }

    @Test
    fun inboxTile() = shot("inbox_tile", DpSize(176.dp, 115.dp)) {
        InboxQuickAddContent(isConfigured = true, inboxCount = 2, backgroundOpacity = 0.96f)
    }

    @Test
    fun inboxRow() = shot("inbox_row", DpSize(362.dp, 56.dp)) {
        InboxQuickAddContent(isConfigured = true, inboxCount = 2, backgroundOpacity = 0.96f)
    }

    private fun shot(name: String, size: DpSize, content: @Composable () -> Unit) {
        val remoteViews = runBlocking { PreviewWidget(content).compose(context, size = size) }
        val controller = Robolectric.buildActivity(Activity::class.java)
        controller.get().setTheme(android.R.style.Theme_DeviceDefault_NoActionBar)
        val activity = controller.setup().get()
        val density = activity.resources.displayMetrics.density
        val wallpaper = FrameLayout(activity).apply { setBackgroundColor(Color.parseColor("#C9CED6")) }
        val pad = (14 * density).toInt()
        val width = (size.width.value * density).toInt()
        val height = (size.height.value * density).toInt()
        val widget = remoteViews.apply(activity, wallpaper)
        wallpaper.addView(widget, FrameLayout.LayoutParams(width, height).apply { setMargins(pad, pad, pad, pad) })
        activity.setContentView(wallpaper, ViewGroup.LayoutParams(width + 2 * pad, height + 2 * pad))
        wallpaper.measure(
            View.MeasureSpec.makeMeasureSpec(width + 2 * pad, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(height + 2 * pad, View.MeasureSpec.EXACTLY),
        )
        wallpaper.layout(0, 0, wallpaper.measuredWidth, wallpaper.measuredHeight)
        wallpaper.captureRoboImage("src/test/screenshots/widget_$name.png")
    }

    private class PreviewWidget(private val content: @Composable () -> Unit) : GlanceAppWidget() {
        override val sizeMode = SizeMode.Exact

        override suspend fun provideGlance(context: Context, id: GlanceId) {
            provideContent { content() }
        }
    }
}
