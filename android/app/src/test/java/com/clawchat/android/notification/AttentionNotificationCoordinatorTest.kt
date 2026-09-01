package com.clawchat.android.notification

import com.clawchat.android.core.data.AppRuntimeState
import com.clawchat.android.core.data.ActiveSession
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.feature.progress.NowAction
import com.clawchat.android.feature.progress.NowItem
import com.clawchat.android.feature.progress.NowSource
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AttentionNotificationCoordinatorTest {
    @Test
    fun `attention result only belongs to the active server workspace`() {
        val server = AppRuntimeState(
            mode = WorkspaceMode.SERVER,
            activeSession = ActiveSession(
                token = "token",
                apiBaseUrl = "https://example.test",
                hostId = null,
                authMode = "manual",
            ),
            hasSavedServerSession = true,
            workspaceKey = "workspace-b",
        )

        assertTrue(isActiveServerWorkspace(server, "workspace-b"))
        assertFalse(isActiveServerWorkspace(server, "workspace-a"))
        assertFalse(
            isActiveServerWorkspace(
                server.copy(mode = WorkspaceMode.LOCAL, activeSession = null),
                "workspace-b",
            ),
        )
    }

    @Test
    fun `only blocking verbs produce attention notifications`() {
        assertTrue(shouldNotifyForAttention(item(NowAction.ANSWER)))
        assertTrue(shouldNotifyForAttention(item(NowAction.APPROVE)))
        assertTrue(shouldNotifyForAttention(item(NowAction.RETRY)))
        assertFalse(shouldNotifyForAttention(item(NowAction.FILE)))
    }

    @Test
    fun `new work alerts while a shrinking active digest updates silently`() {
        assertTrue(
            attentionDelivery(emptySet(), setOf("answer:1"), false) == AttentionDelivery.ALERT,
        )
        assertTrue(
            attentionDelivery(
                setOf("answer:1", "retry:2"),
                setOf("retry:2"),
                true,
            ) == AttentionDelivery.SILENT,
        )
    }

    @Test
    fun `viewed digest is not recreated until new work appears`() {
        assertTrue(
            attentionDelivery(setOf("answer:1"), setOf("answer:1"), false) ==
                AttentionDelivery.NONE,
        )
        assertTrue(
            attentionDelivery(
                setOf("answer:1"),
                setOf("answer:1", "approve:2"),
                false,
            ) == AttentionDelivery.ALERT,
        )
    }

    private fun item(action: NowAction) = NowItem(
        stableId = "todo:1",
        source = NowSource.TODO,
        sourceId = "1",
        action = action,
        title = "Task",
        updatedAt = "2026-09-01T00:00:00Z",
        canHandleOnDevice = true,
    )
}
