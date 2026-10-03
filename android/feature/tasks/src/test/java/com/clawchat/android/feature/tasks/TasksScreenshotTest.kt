package com.clawchat.android.feature.tasks

import androidx.compose.material3.SnackbarHostState
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.ui.theme.ClawChatTheme
import com.github.takahirom.roborazzi.captureRoboImage
import java.util.TimeZone
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** The task list and a task page, light/English and dark/Korean. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h851dp-xxhdpi")
class TasksScreenshotTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Before
    fun pinTimeZone() {
        // Baseline images must not depend on the machine's zone.
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
    }

    private val tasks = listOf(
        Todo(id = "t1", title = "Draft the quarterly report", dueDate = "2026-10-03", priority = "high", syncStatus = "synced"),
        Todo(id = "t2", title = "Book the offsite venue", dueDate = "2026-10-06", syncStatus = "synced"),
        Todo(id = "t3", title = "Reply to the reviewers", syncStatus = "synced"),
        Todo(id = "t4", title = "Order new monitors", status = TaskStatus.COMPLETED, syncStatus = "synced"),
    )

    private val detailTask = Todo(
        id = "t1",
        title = "Draft the quarterly report",
        description = "Summarize revenue, hiring and the roadmap changes for the board.",
        dueDate = "2026-10-03",
        priority = "high",
        tags = listOf("finance", "board"),
        syncStatus = "synced",
    )

    @Test
    fun taskListLight() = captureList("light", null)

    @Test
    @Config(qualifiers = "+ko")
    fun taskListDarkKorean() = captureList("dark", "ko")

    @Test
    fun taskDetailLight() = captureDetail("light", null)

    @Test
    @Config(qualifiers = "+ko")
    fun taskDetailDarkKorean() = captureDetail("dark", "ko")

    private fun name(kind: String, theme: String, locale: String?) =
        "src/test/screenshots/tasks_${kind}_${theme}${locale?.let { "_$it" } ?: ""}.png"

    private fun captureList(theme: String, locale: String?) {
        composeRule.setContent {
            ClawChatTheme(themeModeKey = theme) {
                TaskListView(
                    onOpenProjects = {},
                    tasks = tasks,
                    isLoading = false,
                    snackbarHostState = SnackbarHostState(),
                    onOpenSearch = {},
                    onSelect = {},
                    onToggle = {},
                    onDelete = {},
                    onSetDueToday = {},
                    onCreate = {},
                )
            }
        }
        composeRule.onRoot().captureRoboImage(name("list", theme, locale))
    }

    private fun captureDetail(theme: String, locale: String?) {
        composeRule.setContent {
            ClawChatTheme(themeModeKey = theme) {
                TaskDetailView(
                    steps = TaskStepsState(
                        items = listOf(
                            Todo(id = "s1", title = "Pull the revenue numbers", parentId = "t1", syncStatus = "synced"),
                            Todo(
                                id = "s2",
                                title = "Write the hiring section",
                                parentId = "t1",
                                status = TaskStatus.COMPLETED,
                                syncStatus = "synced",
                            ),
                        ),
                    ),
                    onOpenStep = {},
                    onStepEdit = {},
                    onStepAdd = {},
                    onStepsReload = {},
                    notes = null,
                    onNoteChange = {},
                    onSendNote = {},
                    onReloadNotes = {},
                    task = detailTask,
                    relationships = emptyList(),
                    isLoadingRelationships = false,
                    relationshipError = null,
                    taskTitles = emptyMap(),
                    snackbarHostState = SnackbarHostState(),
                    onBack = {},
                    onToggle = {},
                    onSetDueDate = {},
                    onDelete = {},
                )
            }
        }
        composeRule.onRoot().captureRoboImage(name("detail", theme, locale))
    }
}
