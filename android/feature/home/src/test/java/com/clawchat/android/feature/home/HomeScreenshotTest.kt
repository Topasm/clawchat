package com.clawchat.android.feature.home

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
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

/** The home list with work in progress and three projects, light/English and dark/Korean. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h851dp-xxhdpi")
class HomeScreenshotTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Before
    fun pinTimeZone() {
        // Baseline images must not depend on the machine's zone.
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
    }

    private fun shot(kind: String, theme: String, locale: String?) =
        "src/test/screenshots/home_${kind}_${theme}${locale?.let { "_$it" } ?: ""}.png"

    private val state = HomeUiState(
        checkCount = 2,
        runningCount = 1,
        projects = listOf(
            HomeProject("p1", "Offsite planning", done = 3, total = 8),
            HomeProject("p2", "Release notes", done = 6, total = 7),
            HomeProject("p3", "Customer interviews", done = 0, total = 5),
        ),
        isConnected = true,
        isLoading = false,
    )

    @Test
    fun listLight() = capture("light", null)

    @Test
    @Config(qualifiers = "+ko")
    fun listDarkKorean() = capture("dark", "ko")

    private fun capture(theme: String, locale: String?) {
        composeRule.setContent {
            ClawChatTheme(themeModeKey = theme) {
                Surface(color = MaterialTheme.colorScheme.background) {
                    HomeContent(
                        state = state,
                        showServerFeatures = true,
                        isLocalOnly = false,
                        snackbarHostState = SnackbarHostState(),
                        onOpenInbox = {},
                        onOpenToday = {},
                        onOpenSchedule = {},
                        onOpenTasks = {},
                        onOpenProgress = {},
                        onOpenProject = {},
                        onOpenAllProjects = {},
                        onOpenChat = {},
                        onOpenDevices = {},
                        onOpenSettings = {},
                        onOpenSearch = {},
                    )
                }
            }
        }
        composeRule.onRoot().captureRoboImage(shot("list", theme, locale))
    }
}
