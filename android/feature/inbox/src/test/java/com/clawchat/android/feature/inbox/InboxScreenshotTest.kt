package com.clawchat.android.feature.inbox

import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.clawchat.android.core.data.model.InboxGraph
import com.clawchat.android.core.data.model.ProjectPlan
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.repository.InboxPlacementSnapshot
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

/** The server inbox: captures with a suggested place, one waiting for a choice. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h851dp-xxhdpi")
class InboxScreenshotTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Before
    fun pinTimeZone() {
        // Baseline images must not depend on the machine's zone.
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
    }

    private fun shot(kind: String, variant: String) = "src/test/screenshots/inbox_${kind}_$variant.png"

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

    private val state = InboxPlacementState(
        server = true,
        snapshot = InboxPlacementSnapshot(
            tasks = listOf(
                Todo(id = "c1", title = "Book flights for the Berlin trip", inboxState = "plan_ready", syncStatus = "synced"),
                Todo(id = "c2", title = "Ideas for the offsite", inboxState = "captured", syncStatus = "synced"),
                Todo(id = "c3", title = "Renew the domain", dueDate = "2030-03-14", inboxState = "plan_ready", syncStatus = "synced"),
            ),
            total = 3,
            projects = listOf(
                ProjectPlan(id = "p1", title = "Berlin conference", rootTaskId = "r1"),
                ProjectPlan(id = "p2", title = "Admin", rootTaskId = "r2"),
            ),
            graph = InboxGraph(revision = 7),
        ),
        choices = mapOf(
            "c1" to PlacementChoice(projectId = "p1", parentId = "r1"),
            "c3" to PlacementChoice(projectId = null, parentId = null),
        ),
    )

    private val actions = object : InboxPlacementActions {
        override fun refresh() = Unit
        override fun undo() = Unit
        override fun approve(taskId: String) = Unit
        override fun defer(taskId: String) = Unit
        override fun resumeDeferred() = Unit
        override fun changePage(delta: Int) = Unit
        override fun editPlacement(taskId: String, choice: PlacementChoice, includeDeadline: Boolean, expectedRevision: Long, onSaved: () -> Unit) = Unit
    }

    @Test
    fun inboxLight() = capture("light", "light")

    @Test
    @Config(qualifiers = "+ko")
    fun inboxDarkKorean() = capture("dark", "dark_ko")

    @Test
    fun inboxLargeFont() = capture("light", "light_large", largeFont = true)

    private fun capture(theme: String, variant: String, largeFont: Boolean = false) {
        render(theme, largeFont) {
            androidx.compose.foundation.layout.Box(Modifier.padding(16.dp)) {
                InboxPlacementSection(state = state, viewModel = actions, onOpenPlacement = { _, _ -> })
            }
        }
        composeRule.onRoot().captureRoboImage(shot("placement", variant))
    }
}
