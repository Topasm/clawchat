package com.clawchat.android.feature.today

import androidx.compose.material3.SnackbarHostState
import androidx.compose.ui.unit.Density
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.runtime.CompositionLocalProvider
import com.clawchat.android.core.data.model.Event
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.clawchat.android.core.ui.theme.ClawChatTheme
import com.github.takahirom.roborazzi.captureRoboImage
import java.util.TimeZone
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Today with overdue, focus and inbox items and an event, light/English and dark/Korean. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h851dp-xxhdpi")
class TodayScreenshotTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Before
    fun pinTimeZone() {
        // Baseline images must not depend on the machine's zone.
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
    }

    private fun shot(kind: String, theme: String, locale: String?) =
        "src/test/screenshots/today_${kind}_${theme}${locale?.let { "_$it" } ?: ""}.png"

    private val state = TodayUiState(
        greeting = "Good morning",
        overdueTodos = listOf(Todo(id = "o1", title = "Send the invoice", dueDate = "2026-10-01", syncStatus = "synced")),
        todayTodos = listOf(
            Todo(id = "t1", title = "Draft the quarterly report", dueDate = "2026-10-03", syncStatus = "synced"),
            Todo(id = "t2", title = "Call the venue", dueDate = "2026-10-03", status = TaskStatus.COMPLETED, syncStatus = "synced"),
        ),
        todayEvents = listOf(
            Event(id = "e1", title = "Design review", startTime = "2026-10-03T14:00:00Z", endTime = "2026-10-03T15:00:00Z"),
        ),
        inboxCount = 2,
        inboxPreview = listOf(
            Todo(id = "i1", title = "Ideas for the offsite", inboxState = "captured", syncStatus = "synced"),
            Todo(id = "i2", title = "Reply to Mina", inboxState = "plan_ready", planSummary = "Two steps, about 20 minutes", syncStatus = "synced"),
        ),
    )

    @Test
    fun todayLight() = capture("light", null)

    @Test
    @Config(qualifiers = "+ko")
    fun todayDarkKorean() = capture("dark", "ko")

    @Test
    fun todayLargeFont() = capture("light", "large", largeFont = true)

    private fun capture(theme: String, locale: String?, largeFont: Boolean = false) {
        composeRule.setContent {
            ClawChatTheme(themeModeKey = theme) {
                val density = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides if (largeFont) Density(density.density, fontScale = 2f) else density) {
                    TodayContent(
                        state = state,
                        showAgentFeatures = true,
                        snackbarHostState = SnackbarHostState(),
                        onNavigateToInbox = {},
                        onNavigateToReview = {},
                        onNavigateToRuns = {},
                        onNavigateToSearch = {},
                        onOpenTask = {},
                        onRefresh = {},
                        onToggle = {},
                        onDelete = {},
                        onSetDueToday = {},
                        onQuickAdd = {},
                    )
                }
            }
        }
        composeRule.onRoot().captureRoboImage(shot("screen", theme, locale))
    }
}
