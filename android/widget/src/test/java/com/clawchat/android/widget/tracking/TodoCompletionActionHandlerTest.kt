package com.clawchat.android.widget.tracking

import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.TodoUpdate
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TodoCompletionActionHandlerTest {

    @Test
    fun `unexpected repository error becomes visible failure`() = runTest {
        val handler = TodoCompletionActionHandler { _, _ -> error("storage failure") }
        assertFalse(handler.complete("todo-1"))
    }

    @Test
    fun `replayed completion always writes completed instead of toggling`() = runTest {
        val writes = mutableListOf<Pair<String, TodoUpdate>>()
        val handler = TodoCompletionActionHandler { id, update ->
            writes += id to update
            true
        }

        assertTrue(handler.complete("todo-1"))
        assertTrue(handler.complete("todo-1"))

        assertEquals(2, writes.size)
        assertTrue(writes.all { it.first == "todo-1" })
        assertTrue(writes.all { it.second.status == TaskStatus.COMPLETED })
    }

    @Test
    fun `blank todo id is ignored`() = runTest {
        var called = false
        val handler = TodoCompletionActionHandler { _, _ ->
            called = true
            true
        }

        assertFalse(handler.complete(" "))
        assertFalse(called)
    }

    @Test
    fun `repository failure is returned to caller`() = runTest {
        val handler = TodoCompletionActionHandler { _, _ -> false }

        assertFalse(handler.complete("todo-1"))
    }
}
