package com.clawchat.android.notification

import com.clawchat.android.feature.progress.NowAction
import com.clawchat.android.feature.progress.NowItem
import com.clawchat.android.feature.progress.NowSource
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AttentionNotificationCoordinatorTest {
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
