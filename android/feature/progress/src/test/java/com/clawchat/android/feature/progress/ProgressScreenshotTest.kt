package com.clawchat.android.feature.progress

import com.clawchat.android.core.data.model.AgentRun
import com.clawchat.android.core.data.model.AgentRunStatus
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

/** "Now": runs waiting for an answer and a failed one, light/English and dark/Korean. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h851dp-xxhdpi")
class ProgressScreenshotTest {

    @get:Rule
    val composeRule = createComposeRule()

    private fun shot(kind: String, theme: String, locale: String?) =
        "build/outputs/roborazzi/progress_${kind}_${theme}${locale?.let { "_$it" } ?: ""}.png"

    private val state = ProgressUiState(
        runs = listOf(
            run("r1", "Pick a venue for the offsite", AgentRunStatus.WAITING_INPUT, message = "Which city should I search in?"),
            run("r2", "Summarize the customer interviews", AgentRunStatus.FAILED, error = "The CLI exited before finishing"),
            run("r3", "Draft the release notes", AgentRunStatus.RUNNING, message = "Reading merged pull requests"),
        ),
        isConnected = true,
        isLoading = false,
    )

    @Test
    fun nowLight() = capture("light", null)

    @Test
    @Config(qualifiers = "+ko")
    fun nowDarkKorean() = capture("dark", "ko")

    private fun capture(theme: String, locale: String?) {
        composeRule.setContent {
            ClawChatTheme(themeModeKey = theme) {
                ProgressContent(
                    state = state,
                    onOpenReview = {},
                    onOpenRun = {},
                    onOpenTask = {},
                    onSelectAction = {},
                    onRetryPending = {},
                )
            }
        }
        composeRule.onRoot().captureRoboImage(shot("now", theme, locale))
    }
}

private fun run(id: String, title: String, status: AgentRunStatus, message: String? = null, error: String? = null) = AgentRun(
    id = id,
    agentTaskId = "task_$id",
    todoId = "todo_$id",
    todoTitle = title,
    taskType = "research",
    instruction = title,
    instructionSnapshot = title,
    attempt = 1,
    provider = "codex_cli",
    status = status,
    progressMessage = message,
    error = error,
    createdAt = "2026-10-03T08:00:00Z",
    updatedAt = "2026-10-03T08:30:00Z",
)
