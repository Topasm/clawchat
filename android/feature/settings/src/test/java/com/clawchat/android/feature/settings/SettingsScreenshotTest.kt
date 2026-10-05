package com.clawchat.android.feature.settings

import androidx.compose.foundation.background
import androidx.compose.ui.unit.Density
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.material3.Surface
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.notification.PushStatus
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

/** Settings sections a connected phone shows, light/English and dark/Korean. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h851dp-xxhdpi")
class SettingsScreenshotTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Before
    fun pinTimeZone() {
        // Baseline images must not depend on the machine's zone.
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
    }

    private fun shot(kind: String, theme: String, locale: String?) =
        "src/test/screenshots/settings_${kind}_${theme}${locale?.let { "_$it" } ?: ""}.png"

    @Test
    fun settingsLight() = capture("light", null, PushStatus.ACTIVE)

    @Test
    @Config(qualifiers = "+ko")
    fun settingsDarkKorean() = capture("dark", "ko", PushStatus.SERVER_DISABLED)

    @Test
    fun settingsLargeFont() = capture("light", "large", PushStatus.NOT_CONFIGURED, largeFont = true)

    private fun capture(theme: String, locale: String?, push: PushStatus, largeFont: Boolean = false) {
        val state = SettingsUiState(
            workspaceMode = WorkspaceMode.SERVER,
            hostName = "studio-desktop",
            authMode = "paired",
            themeMode = theme,
        )
        composeRule.setContent {
            ClawChatTheme(themeModeKey = theme) {
                val density = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides if (largeFont) Density(density.density, fontScale = 2f) else density) {
                    Surface(color = MaterialTheme.colorScheme.background) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(MaterialTheme.colorScheme.background)
                            .padding(horizontal = 12.dp, vertical = 4.dp),
                    ) {
                        WorkspaceModeSection(
                            state = state,
                            onConnectWorkspace = {},
                            onActivateSavedServer = {},
                            onSwitchToLocal = {},
                        )
                        PushStatusSection(push)
                        ThemeModeCard(selectedKey = theme, onSelect = {})
                        AccentColorCard(selectedKey = "system", onSelect = {})
                    }
                }
                }
            }
        }
        composeRule.onRoot().captureRoboImage(shot("sections", theme, locale))
    }
}
