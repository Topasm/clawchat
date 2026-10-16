package com.clawchat.android.feature.inbox

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.Density
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.clawchat.android.core.data.model.InboxRouting
import com.clawchat.android.core.data.model.ProjectFolderCandidate
import com.clawchat.android.core.data.model.ProjectPlan
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.repository.InboxSnapshot
import com.clawchat.android.core.ui.theme.ClawChatTheme
import com.github.takahirom.roborazzi.captureRoboImage
import java.util.TimeZone
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** The Inbox as two lists: what it just organized, and what still needs a look. */
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

    private val state = InboxUiState(
        snapshot = InboxSnapshot(
            routings = listOf(
                InboxRouting(
                    id = "r1", origin = "auto", kind = "task", todoId = "t1", title = "Send the conference slides",
                    originalTitle = "Send the conference slides Nov 3", dueDate = "2030-11-03T00:00:00Z",
                    createdAt = "2030-11-01T09:00:00Z",
                ),
                InboxRouting(
                    id = "r2", origin = "auto", kind = "task", todoId = "t2", title = "Draft the methods chapter",
                    originalTitle = "Draft the methods chapter", projectFolder = "01_Projects/Thesis",
                    createdAt = "2030-11-01T09:05:00Z",
                ),
                InboxRouting(
                    id = "r3", origin = "auto", kind = "note", noteId = "n1", title = "Offsite could be in Busan",
                    originalTitle = "Offsite could be in Busan", createdAt = "2030-11-01T09:10:00Z",
                    kindConfidence = 0.55,
                ),
            ),
            captures = listOf(
                Todo(id = "c1", title = "Something the classifier could not read", inboxState = "error", syncStatus = "synced"),
                Todo(id = "c2", title = "Call about the lease", inboxState = "captured", syncStatus = "synced"),
                Todo(id = "c3", title = "Look into the new grant", inboxState = "captured", syncStatus = "synced"),
            ),
            projectOf = mapOf("t1" to "p1"),
            projects = listOf(ProjectPlan("p1", "Berlin conference"), ProjectPlan("p2", "Admin")),
            candidates = listOf(ProjectFolderCandidate("Garden", "01_Projects/Garden", "Phone vault")),
        ),
        isLoading = false,
    )

    @Test
    fun inboxLight() = capture("light", "light")

    @Test
    @Config(qualifiers = "+ko")
    fun inboxDarkKorean() = capture("dark", "dark_ko")

    @Test
    fun inboxLargeFont() = capture("light", "light_large", largeFont = true)

    @Test
    fun inboxSelecting() = capture("light", "selecting", state.copy(selected = setOf("c2", "c3")))

    @Test
    fun inboxEmpty() = capture("light", "empty", InboxUiState(isLoading = false))

    private fun capture(theme: String, variant: String, state: InboxUiState = this.state, largeFont: Boolean = false) {
        render(theme, largeFont) {
            InboxLists(state = state, onAction = {}, onOpenTask = {}, onOpenNotes = {})
        }
        composeRule.onRoot().captureRoboImage(shot("lists", variant))
    }
}
