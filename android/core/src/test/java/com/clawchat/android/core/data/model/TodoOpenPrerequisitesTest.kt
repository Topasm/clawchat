package com.clawchat.android.core.data.model

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

class TodoOpenPrerequisitesTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `reads the prerequisites the server names and defaults to none`() {
        val waiting = json.decodeFromString<Todo>(
            """{"id":"submit","title":"Submit","status":"pending","priority":"medium",
               "open_prerequisites":[{"id":"kernel","title":"Write the kernel"}]}""",
        )
        assertEquals(listOf(OpenPrerequisite("kernel", "Write the kernel")), waiting.waitingOn())

        val older = json.decodeFromString<Todo>(
            """{"id":"read","title":"Read","status":"pending","priority":"medium"}""",
        )
        assertEquals(emptyList<OpenPrerequisite>(), older.waitingOn())
    }

    @Test
    fun `a finished task waits on nothing whatever its edges say`() {
        val done = json.decodeFromString<Todo>(
            """{"id":"submit","title":"Submit","status":"completed","priority":"medium",
               "open_prerequisites":[{"id":"kernel","title":"Write the kernel"}]}""",
        )
        assertEquals(emptyList<OpenPrerequisite>(), done.waitingOn())
    }
}
