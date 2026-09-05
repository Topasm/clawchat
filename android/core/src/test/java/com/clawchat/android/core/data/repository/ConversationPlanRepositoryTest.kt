package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.model.ChatPlanApplyRequest
import com.clawchat.android.core.data.model.ChatPlanApplyResult
import com.clawchat.android.core.network.ApiResult
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import java.io.IOException
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ConversationPlanRepositoryTest {
    private val api = mockk<ClawChatApi>()
    private val repository = ConversationRepositoryImpl(api)

    @Test
    fun `apply dismiss and undo preserve exact proposal and change set identities`() = runTest {
        val request = ChatPlanApplyRequest("proposal", 42)
        val result = ChatPlanApplyResult("change", true)
        coEvery { api.applyChatPlan("task", request) } returns result
        coEvery { api.dismissChatPlan("task", mapOf("proposal_id" to "proposal")) } returns JsonObject(emptyMap())
        coEvery { api.undoChatPlan("change") } returns JsonObject(emptyMap())
        assertEquals(result, (repository.applyPlan("task", request) as ApiResult.Success).data)
        assertTrue(repository.dismissPlan("task", "proposal") is ApiResult.Success)
        assertTrue(repository.undoPlan("change") is ApiResult.Success)
        coVerify(exactly = 1) { api.applyChatPlan("task", request) }
        coVerify(exactly = 1) { api.dismissChatPlan("task", mapOf("proposal_id" to "proposal")) }
        coVerify(exactly = 1) { api.undoChatPlan("change") }
    }

    @Test
    fun `failed apply reports failure without silently retrying a mutation`() = runTest {
        coEvery { api.applyChatPlan(any(), any()) } throws IOException("offline")
        assertTrue(repository.applyPlan("task", ChatPlanApplyRequest("proposal", 42)) is ApiResult.Error)
        coVerify(exactly = 1) { api.applyChatPlan(any(), any()) }
    }
}
