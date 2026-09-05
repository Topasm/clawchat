package com.clawchat.android.core.data.model

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class InboxPlacementModelsTest {
    @Test fun `deadline timezone and offline capture anchor survive serialization`() {
        val json = Json { encodeDefaults = false }
        val request = InboxTriageRequest(listOf("t"), 3, "Asia/Seoul")
        assertEquals(request, json.decodeFromString<InboxTriageRequest>(json.encodeToString(request)))
        val placement = InboxPlacementRequest("p", null, "none", 3, "2026-09-04T14:59:59Z")
        assertEquals(placement, json.decodeFromString<InboxPlacementRequest>(json.encodeToString(placement)))
        val capture = TodoCreate(title = "금요일까지 논문", capturedAt = "2026-09-02T10:00:00Z")
        assertEquals(capture, json.decodeFromString<TodoCreate>(json.encodeToString(capture)))
    }
    @Test fun `standalone destination sends mandatory nulls and revision zero`() {
        val json = Json { encodeDefaults = false }
        val body = Json.parseToJsonElement(json.encodeToString(InboxPlacementRequest(null, null, "none", 0))).jsonObject
        assertEquals(JsonNull, body["project_id"])
        assertEquals(JsonNull, body["parent_id"])
        assertEquals(JsonPrimitive(0), body["expected_graph_revision"])
        assertEquals(JsonPrimitive("none"), body["inbox_state"])
    }
}
