package com.clawchat.android.core.data.model

import com.clawchat.android.core.data.local.TodoEntity
import com.clawchat.android.core.data.local.toEntity
import com.clawchat.android.core.data.local.toModel
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class TaskStatusTest {

    @Test
    fun `serializes every canonical API wire value`() {
        val expected = mapOf(
            TaskStatus.PENDING to "pending",
            TaskStatus.IN_PROGRESS to "in_progress",
            TaskStatus.COMPLETED to "completed",
            TaskStatus.CANCELLED to "cancelled",
        )

        assertEquals(expected.keys, TaskStatus.entries.toSet())
        expected.forEach { (status, wireValue) ->
            assertEquals("\"$wireValue\"", Json.encodeToString(status))
            assertEquals(status, Json.decodeFromString<TaskStatus>("\"$wireValue\""))
            assertEquals(wireValue, status.wireValue)
        }
    }

    @Test
    fun `rejects a status outside the canonical contract`() {
        assertThrows(IllegalArgumentException::class.java) {
            TaskStatus.fromWireValue("done")
        }
    }

    @Test
    fun `room mapper persists canonical wire values`() {
        val todo = Todo(id = "task-1", title = "Ship", status = TaskStatus.IN_PROGRESS)
        assertEquals("in_progress", todo.toEntity().status)

        val cached = TodoEntity(
            id = "task-2",
            title = "Review",
            status = "cancelled",
            createdAt = "",
            updatedAt = "",
        )
        assertEquals(TaskStatus.CANCELLED, cached.toModel().status)
    }
}
