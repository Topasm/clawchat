package com.clawchat.android.core.data.model

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class TodoProjectContextTest {
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = false
        explicitNulls = false
    }

    @Test
    fun `decodes project context from a server todo`() {
        val payload = """
            {
              "id": "step-a",
              "title": "E65a Run baseline",
              "project_id": "project-p0-r",
              "priority": "high",
              "source": "obsidian",
              "source_id": "P0-R/TODO.md",
              "assignee": "agent",
              "estimated_minutes": 45,
              "project_label": "P0-R Semantic referent binding"
            }
        """.trimIndent()

        val todo = json.decodeFromString<Todo>(payload)

        assertEquals("project-p0-r", todo.projectId)
        assertEquals("high", todo.priority)
        assertEquals("obsidian", todo.source)
        assertEquals("P0-R/TODO.md", todo.sourceId)
        assertEquals("agent", todo.assignee)
        assertEquals(45, todo.estimatedMinutes)
        assertEquals("P0-R Semantic referent binding", todo.projectLabel)
    }

    @Test
    fun `encodes project context for create and update requests`() {
        val createPayload = json.parseToJsonElement(
            json.encodeToString(
                TodoCreate(
                    title = "E65a Run baseline",
                    projectId = "project-p0-r",
                    parentId = "question-e65",
                    priority = "high",
                    source = "obsidian",
                    sourceId = "P0-R/TODO.md",
                    assignee = "agent",
                    estimatedMinutes = 45,
                ),
            ),
        ).jsonObject
        val updatePayload = json.parseToJsonElement(
            json.encodeToString(
                TodoUpdate(
                    projectId = "project-p0-r",
                    parentId = "question-e65",
                    priority = "high",
                    source = "obsidian",
                    sourceId = "P0-R/TODO.md",
                    assignee = "agent",
                    estimatedMinutes = 45,
                ),
            ),
        ).jsonObject

        listOf(createPayload, updatePayload).forEach { payload ->
            assertEquals("project-p0-r", payload.getValue("project_id").jsonPrimitive.content)
            assertEquals("question-e65", payload.getValue("parent_id").jsonPrimitive.content)
            assertEquals("high", payload.getValue("priority").jsonPrimitive.content)
            assertEquals("obsidian", payload.getValue("source").jsonPrimitive.content)
            assertEquals("P0-R/TODO.md", payload.getValue("source_id").jsonPrimitive.content)
            assertEquals("agent", payload.getValue("assignee").jsonPrimitive.content)
            assertEquals("45", payload.getValue("estimated_minutes").jsonPrimitive.content)
        }
    }
}
