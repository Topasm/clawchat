package com.clawchat.android.feature.onboarding

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

/** First run: the welcome step and the pairing-code step. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h851dp-xxhdpi")
class OnboardingScreenshotTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Before
    fun pinTimeZone() {
        // Baseline images must not depend on the machine's zone.
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
    }

    private fun shot(kind: String, variant: String) = "src/test/screenshots/onboarding_${kind}_$variant.png"

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

    @Test
    fun welcomeLight() = welcome("light", "light")

    @Test
    @Config(qualifiers = "+ko")
    fun welcomeDarkKorean() = welcome("dark", "dark_ko")

    @Test
    fun welcomeLargeFont() = welcome("light", "light_large", largeFont = true)

    @Test
    fun pairingLight() = pairing("light", "light")

    @Test
    @Config(qualifiers = "+ko")
    fun pairingDarkKorean() = pairing("dark", "dark_ko")

    private fun welcome(theme: String, variant: String, largeFont: Boolean = false) {
        render(theme, largeFont) {
            WelcomeStep(
                isSelectingLocalMode = false,
                error = null,
                onScanQr = {},
                onManualConnect = {},
                onUseLocal = {},
            )
        }
        composeRule.onRoot().captureRoboImage(shot("welcome", variant))
    }

    private fun pairing(theme: String, variant: String) {
        render(theme) {
            PairingStep(
                code = "482",
                isPairing = false,
                error = null,
                onCodeChange = {},
                onSubmit = {},
                onBack = {},
                onManualLogin = {},
            )
        }
        composeRule.onRoot().captureRoboImage(shot("pairing", variant))
    }
}
