package com.clawchat.android.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.clawchat.android.core.ui.icons.ClawIcons
import com.clawchat.android.core.ui.theme.ClawChatTheme
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The shared design system on one page, light and dark.
 *
 * Images land in `build/outputs/roborazzi/` when run with
 * `./gradlew :core:recordRoborazziDebug`; a plain `testDebugUnitTest` only
 * renders them, so a component that throws while composing still fails CI.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h851dp-xxhdpi")
class DesignSystemScreenshotTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun designSystemLight() = capture("light")

    @Test
    fun designSystemDark() = capture("dark")

    private fun capture(theme: String) {
        composeRule.setContent {
            ClawChatTheme(themeModeKey = theme) {
                Gallery()
            }
        }
        composeRule.onRoot().captureRoboImage("build/outputs/roborazzi/core_design_system_$theme.png")
    }
}

@Composable
private fun Gallery() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.background)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ClawSectionHeader(title = "Today", subtitle = "3 tasks, 1 event", count = 3, actionLabel = "Open", onActionClick = {})
        ClawSegmentedToggle(options = listOf("Tasks", "Notes"), selectedIndex = 0, onSelect = {})
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ClawStatusChip(text = "Ready", tone = ClawTone.Success)
            ClawStatusChip(text = "Waiting", tone = ClawTone.Warning)
            ClawStatusChip(text = "Failed", tone = ClawTone.Error)
            ClawStatusChip(text = "Agent", tone = ClawTone.Primary)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ClawMetricPill(label = "Ready now", value = "4")
            ClawMetricPill(label = "Running", value = "1")
        }
        ClawListSection(header = { ClawSectionHeader(title = "Needs your input") }) {
            ClawListItemSurface(onClick = {}) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ClawIconTile(icon = ClawIcons.Inbox)
                    Column {
                        Text("Pick a venue for the offsite", style = MaterialTheme.typography.bodyLarge)
                        Text("Agent is waiting for your answer", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            ClawListItemSurface(onClick = {}) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ClawLetterTile(text = "R")
                    Text("Review the draft report", style = MaterialTheme.typography.bodyLarge)
                }
            }
        }
        ClawEmptyState(
            title = "Nothing waiting",
            description = "New captures land here first.",
            actionLabel = "Capture a task",
            onActionClick = {},
        )
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            ClawFab(onClick = {}, contentDescription = "Add")
            ClawLoadingState(modifier = Modifier.height(64.dp), message = "Loading…")
        }
    }
}
