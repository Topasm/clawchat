package com.clawchat.android.core.data.model

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReviewModelsTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `review response decodes enriched server fields`() {
        val payload = """
            {
              "id": "review_1",
              "project_id": "project_1",
              "project_title": "ClawChat",
              "subject_type": "agent_run",
              "subject_id": "run_1",
              "subject_title": "Ship Android review",
              "subject_description": "All checks passed",
              "subject_href": "/runs?run_id=run_1",
              "status": "pending",
              "summary": "Review agent result",
              "risk_level": "high",
              "requested_at": "2026-08-31T12:00:00Z",
              "metadata": {"provider": "codex_cli", "attempt": 2}
            }
        """.trimIndent()

        val item = json.decodeFromString<ReviewItem>(payload)

        assertEquals(ReviewSubjectType.AGENT_RUN, item.subjectType)
        assertEquals(ReviewRiskLevel.HIGH, item.riskLevel)
        assertEquals("ClawChat", item.projectTitle)
        assertEquals("codex_cli", item.metadata["provider"]?.jsonPrimitive?.content)
        assertTrue(item.supportsDecision)
    }

    @Test
    fun `decision request uses canonical server value and omits no context`() {
        val request = ReviewDecisionRequest(
            decision = ReviewDecision.CHANGES_REQUESTED,
            note = "Please add a regression test",
        )

        val payload = json.encodeToString(request)

        assertTrue(payload.contains("\"decision\":\"changes_requested\""))
        assertTrue(payload.contains("\"note\":\"Please add a regression test\""))
    }

    @Test
    fun `plan stays read only without a complete mobile source view`() {
        val item = ReviewItem(
            id = "review-plan",
            subjectType = ReviewSubjectType.PLAN_PROPOSAL,
            subjectId = "plan-1",
            summary = "Review plan",
            requestedAt = "2026-08-31T12:00:00Z",
        )

        assertFalse(item.supportsDecision)
    }

    @Test
    fun `agent approval impact decodes from metadata`() {
        val payload = """
            {
              "id":"review-run",
              "subject_type":"agent_run",
              "subject_id":"run-1",
              "summary":"Review run",
              "requested_at":"2026-08-31T12:00:00Z",
              "metadata":{"approval_impact":{"todo_id":"todo-1","graph_revision":9,
                "newly_ready_tasks":[{"id":"todo-2","title":"Ship"}]}}
            }
        """.trimIndent()

        val item = json.decodeFromString<ReviewItem>(payload)

        assertEquals(9, item.agentRunApprovalImpact?.graphRevision)
        assertEquals("Ship", item.agentRunApprovalImpact?.newlyReadyTasks?.single()?.title)
    }
}
