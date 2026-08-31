package com.clawchat.android.widget.quickadd

import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import org.junit.Assert.assertEquals
import org.junit.Test

class InboxQuickAddModelTest {
    @Test
    fun `cached count includes every open inbox state but not ordinary tasks`() {
        val todos = listOf(
            Todo("captured", "Captured", inboxState = "captured"),
            Todo("planning", "Planning", inboxState = "planning"),
            Todo("ordinary", "Ordinary", inboxState = "none"),
            Todo(
                "completed",
                "Completed capture",
                status = TaskStatus.COMPLETED,
                inboxState = "captured",
            ),
        )

        assertEquals(2, cachedInboxCount(todos))
    }
}
