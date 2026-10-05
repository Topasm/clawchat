package com.clawchat.android.feature.chat

import androidx.compose.material3.SnackbarHostState
import kotlinx.serialization.json.put
import kotlinx.serialization.json.buildJsonObject
import androidx.compose.ui.unit.Density
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.clawchat.android.core.data.model.Conversation
import com.clawchat.android.core.data.model.Message
import com.clawchat.android.core.ui.theme.ClawChatTheme
import com.github.takahirom.roborazzi.captureRoboImage
import java.time.Duration
import java.time.Instant
import java.util.TimeZone
import org.junit.Before
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

    @Before
    fun pinTimeZone() {
        // Baseline images must not depend on the machine's zone.
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
    }

    private val conversations = listOf(
        // Relative to now, so "just now / 14 hours ago / 2 days ago" stay the same in the baseline.
        Conversation(id = "c1", title = "Weekly planning", updatedAt = ago(Duration.ZERO)),
        Conversation(id = "c2", title = "Offsite logistics", updatedAt = ago(Duration.ofHours(14).plusMinutes(10))),
        Conversation(id = "c3", title = "Paper figures", updatedAt = ago(Duration.ofDays(2).plusHours(1)), projectTodoId = "t1"),
    )

    private val messages = listOf(
        Message(id = "m1", role = "user", content = "Can you draft the agenda for Monday?", createdAt = "2026-10-03T09:00:00Z"),
        Message(
            id = "m2",
            role = "assistant",
            content = "Sure. I will group it by project and keep it to 30 minutes.",
            createdAt = "2026-10-03T09:00:05Z",
        ),
        Message(
            id = "m3",
            role = "assistant",
            content = "I need one answer before I continue.",
            createdAt = "2026-10-03T09:00:30Z",
            metadata = buildJsonObject {
                put("action_type", "run_update")
                put("run_id", "run_1")
                put("status", "waiting_input")
                put("title", "Draft the Monday agenda")
            },
        ),
        Message(id = "m4", role = "user", content = "Add the offsite budget too.", createdAt = "2026-10-03T09:01:00Z"),
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

    @Test
    fun threadLargeFont() = captureThread("light", locale = "large", largeFont = true)

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
            "src/test/screenshots/chat_list_${theme}${locale?.let { "_$it" } ?: ""}.png",
        )
    }

    /**
     * The typing indicator is an infinite animation, which never lets Compose
     * go idle; drive the clock by hand and capture a frame mid-pulse.
     */
    private fun captureThread(theme: String, locale: String?, largeFont: Boolean = false) {
        composeRule.mainClock.autoAdvance = false
        composeRule.setContent {
            ClawChatTheme(themeModeKey = theme) {
                val density = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides if (largeFont) Density(density.density, fontScale = 2f) else density) {
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
        }
        composeRule.mainClock.advanceTimeBy(600)
        composeRule.onRoot().captureRoboImage(
            "src/test/screenshots/chat_thread_${theme}${locale?.let { "_$it" } ?: ""}.png",
        )
    }
}

private fun ago(duration: Duration): String = Instant.now().minus(duration).toString()
