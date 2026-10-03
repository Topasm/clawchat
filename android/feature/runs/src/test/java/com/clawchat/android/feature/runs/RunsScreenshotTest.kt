package com.clawchat.android.feature.runs

import androidx.compose.foundation.background
import androidx.compose.material3.Surface
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
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

/** The runs list: summary, filters and rows in each state, light/English and dark/Korean. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h851dp-xxhdpi")
class RunsScreenshotTest {

    @get:Rule
    val composeRule = createComposeRule()

    private fun shot(kind: String, theme: String, locale: String?) =
        "build/outputs/roborazzi/runs_${kind}_${theme}${locale?.let { "_$it" } ?: ""}.png"

    private val runs = listOf(
        run("r1", "Pick a venue for the offsite", AgentRunStatus.WAITING_INPUT, message = "Which city should I search in?"),
        run("r3", "Draft the release notes", AgentRunStatus.RUNNING, message = "Reading merged pull requests"),
        run("r4", "Clean up the figures", AgentRunStatus.WAITING_REVIEW),
        run("r2", "Summarize the customer interviews", AgentRunStatus.FAILED, error = "The CLI exited before finishing"),
        run("r5", "Plan the week", AgentRunStatus.COMPLETED),
    )

    @Test
    fun runsLight() = capture("light", null)

    @Test
    @Config(qualifiers = "+ko")
    fun runsDarkKorean() = capture("dark", "ko")

    private fun capture(theme: String, locale: String?) {
        val state = AgentRunsUiState(runs = runs, isLoading = false)
        composeRule.setContent {
            ClawChatTheme(themeModeKey = theme) {
                Surface(color = MaterialTheme.colorScheme.background) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.background)
                        .padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    RunSummaryCard(state)
                    RunFilters(selected = AgentRunFilter.ALL, onSelect = {})
                    state.visibleRuns.forEach { AgentRunListItem(run = it, onClick = {}) }
                }
            }
            }
        }
        composeRule.onRoot().captureRoboImage(shot("list", theme, locale))
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
