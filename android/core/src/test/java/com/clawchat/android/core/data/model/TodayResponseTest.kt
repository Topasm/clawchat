package com.clawchat.android.core.data.model

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

class TodayResponseTest {

    @Test
    fun `decodes canonical server task field names`() {
        val payload = """
            {
              "greeting": "Good morning",
              "today_tasks": [{"id": "today-1", "title": "Today"}],
              "overdue_tasks": [{"id": "late-1", "title": "Late"}],
              "today_events": [],
              "needs_review": [],
              "inbox_count": 2,
              "date": "2026-09-01"
            }
        """.trimIndent()

        val response = Json { ignoreUnknownKeys = true }.decodeFromString<TodayResponse>(payload)

        assertEquals(listOf("today-1"), response.todayTodos.map(Todo::id))
        assertEquals(listOf("late-1"), response.overdueTodos.map(Todo::id))
        assertEquals(2, response.inboxCount)
    }
}
