package com.clawchat.android.feature.calendar

import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.clawchat.android.core.data.model.Event
import java.time.LocalDate
import java.time.YearMonth
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

/** The month grid, in a fixed month with no "today" in it. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h851dp-xxhdpi")
class MonthScreenshotTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Before
    fun pinTimeZone() {
        // Baseline images must not depend on the machine's zone.
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
    }

    private fun shot(kind: String, variant: String) = "src/test/screenshots/month_${kind}_$variant.png"

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

    private val events = mapOf(
        LocalDate.of(2030, 3, 4) to listOf(Event(id = "e1", title = "Design review", startTime = "2030-03-04T14:00:00Z")),
        LocalDate.of(2030, 3, 12) to listOf(
            Event(id = "e2", title = "Standup", startTime = "2030-03-12T09:00:00Z"),
            Event(id = "e3", title = "Dentist", startTime = "2030-03-12T16:00:00Z"),
        ),
    )

    @Test
    fun monthLight() = capture("light", "light", Locale.US)

    @Test
    @Config(qualifiers = "+ko")
    fun monthDarkKorean() = capture("dark", "dark_ko", Locale.KOREA)

    private fun capture(theme: String, variant: String, locale: Locale) {
        render(theme) {
            androidx.compose.foundation.layout.Box(Modifier.padding(12.dp)) {
                MonthGrid(
                    locale = locale,
                    month = YearMonth.of(2030, 3),
                    selectedDate = LocalDate.of(2030, 3, 12),
                    eventsByDate = events,
                    tasksByDate = emptyMap(),
                    onSelect = {},
                )
            }
        }
        composeRule.onRoot().captureRoboImage(shot("grid", variant))
    }
}
