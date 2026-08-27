package com.clawchat.android.core.data.model

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class TaskRelationshipTypeTest {

    @Test
    fun `serializes every canonical relationship wire value`() {
        val expected = mapOf(
            TaskRelationshipType.DEPENDS_ON to "depends_on",
            TaskRelationshipType.RELATED to "related",
            TaskRelationshipType.DUPLICATE to "duplicate",
        )

        assertEquals(expected.keys, TaskRelationshipType.entries.toSet())
        expected.forEach { (type, wireValue) ->
            assertEquals("\"$wireValue\"", Json.encodeToString(type))
            assertEquals(type, Json.decodeFromString<TaskRelationshipType>("\"$wireValue\""))
            assertEquals(wireValue, type.wireValue)
        }
    }

    @Test
    fun `rejects a relationship type outside the canonical contract`() {
        assertThrows(IllegalArgumentException::class.java) {
            TaskRelationshipType.fromWireValue("blocks")
        }
    }
}

