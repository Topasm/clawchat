package com.clawchat.android.widget.common

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class WidgetRefreshBatchTest {
    @Test
    fun `failed instance does not cancel slower healthy widgets`() = runTest {
        val failure = IllegalStateException("widget removed")
        val refreshed = mutableSetOf<String>()

        try {
            refreshWidgetsIndependently(listOf(
                { throw failure },
                { delay(100); refreshed += "tracking" },
                { delay(200); refreshed += "inbox" },
            ))
            fail("The caller must still receive the failed refresh")
        } catch (error: IllegalStateException) {
            assertEquals(failure.message, error.message)
        }
        assertEquals(setOf("tracking", "inbox"), refreshed)
    }

    @Test
    fun `successful batch and empty batch finish normally`() = runTest {
        var refreshCount = 0
        refreshWidgetsIndependently(emptyList())
        refreshWidgetsIndependently(listOf(
            { delay(100); refreshCount++ },
            { refreshCount++ },
        ))
        assertEquals(2, refreshCount)
    }

    @Test
    fun `cancellation stops other refreshes instead of being treated as an instance failure`() = runTest {
        val started = CompletableDeferred<Unit>()
        var stopped = false
        try {
            refreshWidgetsIndependently(listOf(
                { started.await(); throw CancellationException("workspace changed") },
                {
                    try {
                        started.complete(Unit)
                        awaitCancellation()
                    } finally {
                        stopped = true
                    }
                },
            ))
            fail("Cancellation must propagate")
        } catch (_: CancellationException) {
            assertTrue(stopped)
        }
    }
}
