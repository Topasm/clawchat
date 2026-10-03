package com.clawchat.android.feature.settings

import androidx.compose.foundation.background
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

    private fun shot(kind: String, theme: String, locale: String?) =
        "build/outputs/roborazzi/settings_${kind}_${theme}${locale?.let { "_$it" } ?: ""}.png"

    @Test
    fun settingsLight() = capture("light", null, PushStatus.ACTIVE)

    @Test
    @Config(qualifiers = "+ko")
    fun settingsDarkKorean() = capture("dark", "ko", PushStatus.SERVER_DISABLED)

    private fun capture(theme: String, locale: String?, push: PushStatus) {
        val state = SettingsUiState(
            workspaceMode = WorkspaceMode.SERVER,
            hostName = "studio-desktop",
            authMode = "paired",
            themeMode = theme,
        )
        composeRule.setContent {
            ClawChatTheme(themeModeKey = theme) {
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
        composeRule.onRoot().captureRoboImage(shot("sections", theme, locale))
    }
}
