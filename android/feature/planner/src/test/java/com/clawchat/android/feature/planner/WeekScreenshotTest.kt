package com.clawchat.android.feature.planner

import com.clawchat.android.core.data.model.Todo
import java.time.LocalDate
import java.util.Locale
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.Density
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

/** The week page, in a fixed week so "today" never moves the baseline. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h851dp-xxhdpi")
class WeekScreenshotTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Before
    fun pinTimeZone() {
        // Baseline images must not depend on the machine's zone.
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
    }

    private fun shot(kind: String, variant: String) = "src/test/screenshots/week_${kind}_$variant.png"

    /** Renders [content] on the themed background, optionally at 200% font size. */
    private fun render(theme: String, largeFont: Boolean = false, content: @Composable () -> Unit) {
        composeRule.setContent {
            ClawChatTheme(themeModeKey = theme) {
                val density = LocalDensity.current
                CompositionLocalProvider(
                    LocalDensity provides if (largeFont) Density(density.density, fontScale = 2f) else density,
                ) {
                    Surface(color = MaterialTheme.colorScheme.background) { content() }
                }
            }
        }
    }

    private val range = WeekRange(start = LocalDate.of(2030, 3, 11), endInclusive = LocalDate.of(2030, 3, 17))

    private val state = WeekUiState(
        range = range,
        overdue = listOf(Todo(id = "o1", title = "Send the invoice", dueDate = "2030-03-08", syncStatus = "synced")),
        tasksByDate = mapOf(
            LocalDate.of(2030, 3, 12) to listOf(Todo(id = "t1", title = "Draft the quarterly report", dueDate = "2030-03-12", syncStatus = "synced")),
            LocalDate.of(2030, 3, 14) to listOf(
                Todo(id = "t2", title = "Book the offsite venue", dueDate = "2030-03-14", syncStatus = "synced"),
                Todo(id = "t3", title = "Reply to the reviewers", dueDate = "2030-03-14", syncStatus = "synced"),
            ),
        ),
    )

    @Test
    fun weekLight() = capture("light", "light", Locale.US)

    @Test
    @Config(qualifiers = "+ko")
    fun weekDarkKorean() = capture("dark", "dark_ko", Locale.KOREA)

    private fun capture(theme: String, variant: String, locale: Locale) {
        render(theme) {
            WeekContent(
                state = state,
                locale = locale,
                onToggle = {},
                onDelete = {},
                onSetDueToday = {},
                onOpenTask = {},
                onCreate = {},
            )
        }
        composeRule.onRoot().captureRoboImage(shot("page", variant))
    }
}
