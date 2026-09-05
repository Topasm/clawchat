package com.clawchat.android.core.data.model

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatPlanModelsTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val plan = ChatPlanProposal("p", "t", "draft", 9, subtasks = listOf(ChatPlanStep("Step")))

    @Test
    fun `proposal decodes server fields and serializes explicit revision`() {
        val decoded = json.decodeFromString<ChatPlanProposal>("""
            {"proposal_id":"p", "todo_id":"t", "status":"draft", "base_graph_revision":9,
             "subtasks":[{"title":"Step", "depends_on_indices":[0], "estimated_minutes":15}],
             "diff":{"root_update_fields":["due_date"]}, "subtask_count":1}
        """.trimIndent())
        assertTrue(decoded.canApply)
        assertEquals(listOf(0), decoded.subtasks.single().dependencies)
        assertEquals(15, decoded.subtasks.single().minutes)
        assertEquals("""{"proposal_id":"p","base_graph_revision":9}""",
            json.encodeToString(ChatPlanApplyRequest("p", 9)))
    }

    @Test
    fun `invalid stale or unpreviewable proposals cannot apply`() {
        assertTrue(plan.canApply)
        for (status in listOf("generating", "applying", "applied", "rejected", "stale", "reverted", "failed")) {
            assertFalse(plan.copy(status = status).canApply)
        }
        assertFalse(plan.copy(revision = null).canApply)
        assertFalse(plan.copy(subtasks = emptyList()).canApply)
        assertFalse(plan.copy(validation = ChatPlanValidation(errors = listOf(ChatPlanIssue("cycle", "Cycle")))).canApply)
        assertFalse(plan.copy(diff = ChatPlanDiff(listOf("unknown_field"))).canApply)
    }
}
