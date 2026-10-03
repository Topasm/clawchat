package com.clawchat.android.feature.chat

import androidx.compose.material3.SnackbarHostState
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.clawchat.android.core.data.model.Conversation
import com.clawchat.android.core.data.model.Message
import com.clawchat.android.core.ui.theme.ClawChatTheme
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Conversation list and a thread mid-reply, light/English and dark/Korean. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h851dp-xxhdpi")
class ChatScreenshotTest {

    @get:Rule
    val composeRule = createComposeRule()

    private val conversations = listOf(
        Conversation(id = "c1", title = "Weekly planning", updatedAt = "2026-10-03T09:00:00Z"),
        Conversation(id = "c2", title = "Offsite logistics", updatedAt = "2026-10-02T16:30:00Z"),
        Conversation(id = "c3", title = "Paper figures", updatedAt = "2026-10-01T11:15:00Z", projectTodoId = "t1"),
    )

    private val messages = listOf(
        Message(id = "m1", role = "user", content = "Can you draft the agenda for Monday?", createdAt = "2026-10-03T09:00:00Z"),
        Message(
            id = "m2",
            role = "assistant",
            content = "Sure. I will group it by project and keep it to 30 minutes.",
            createdAt = "2026-10-03T09:00:05Z",
        ),
        Message(id = "m3", role = "user", content = "Add the offsite budget too.", createdAt = "2026-10-03T09:01:00Z"),
    )

    @Test
    fun conversationListLight() = captureList("light", locale = null)

    @Test
    @Config(qualifiers = "+ko")
    fun conversationListDarkKorean() = captureList("dark", locale = "ko")

    @Test
    fun threadWaitingForReplyLight() = captureThread("light", locale = null)

    @Test
    @Config(qualifiers = "+ko")
    fun threadWaitingForReplyDarkKorean() = captureThread("dark", locale = "ko")

    private fun captureList(theme: String, locale: String?) {
        composeRule.setContent {
            ClawChatTheme(themeModeKey = theme) {
                ConversationListView(
                    conversations = conversations,
                    isLoading = false,
                    onOpenSearch = {},
                    onSelect = {},
                    onCreate = {},
                    onDelete = {},
                    onRefresh = {},
                    snackbarHostState = SnackbarHostState(),
                )
            }
        }
        composeRule.onRoot().captureRoboImage(
            "build/outputs/roborazzi/chat_list_${theme}${locale?.let { "_$it" } ?: ""}.png",
        )
    }

    /**
     * The typing indicator is an infinite animation, which never lets Compose
     * go idle; drive the clock by hand and capture a frame mid-pulse.
     */
    private fun captureThread(theme: String, locale: String?) {
        composeRule.mainClock.autoAdvance = false
        composeRule.setContent {
            ClawChatTheme(themeModeKey = theme) {
                ChatDetailView(
                    draftStorage = DraftStorageState(ready = true),
                    onRetryDraft = {},
                    inputText = "",
                    onInputChange = {},
                    title = "Weekly planning",
                    plans = emptyMap(),
                    planChanges = emptyMap(),
                    pendingPlans = emptySet(),
                    onPlanAction = { _, _ -> },
                    messages = messages,
                    streamingText = "",
                    isStreaming = true,
                    isLoadingMessages = false,
                    onSend = {},
                    onStop = {},
                    onResumeRun = { _, _ -> },
                    onResolvePermission = { _, _ -> },
                    onDecideReview = { _, _, _ -> },
                    onBack = {},
                    snackbarHostState = SnackbarHostState(),
                )
            }
        }
        composeRule.mainClock.advanceTimeBy(600)
        composeRule.onRoot().captureRoboImage(
            "build/outputs/roborazzi/chat_thread_${theme}${locale?.let { "_$it" } ?: ""}.png",
        )
    }
}
