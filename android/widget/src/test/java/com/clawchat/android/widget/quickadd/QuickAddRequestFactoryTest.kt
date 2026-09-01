package com.clawchat.android.widget.quickadd

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class QuickAddRequestFactoryTest {

    @Test
    fun `widget capture trims title and always goes to inbox`() {
        val request = QuickAddRequestFactory.create(
            title = "  Send report  ",
            idempotencyKey = "operation-id",
        )!!

        assertEquals("Send report", request.title)
        assertNull(request.dueDate)
        assertEquals("captured", request.inboxState)
        assertEquals("android_widget", request.source)
        assertEquals("operation-id", request.idempotencyKey)
    }

    @Test
    fun `capture has no due date`() {
        val request = QuickAddRequestFactory.create(
            title = "Capture this",
            idempotencyKey = "operation-id",
        )!!

        assertNull(request.dueDate)
        assertEquals("captured", request.inboxState)
    }

    @Test
    fun `explicit metadata is parsed without adding a deadline`() {
        val request = QuickAddRequestFactory.create(
            title = "Send report #work !high",
            idempotencyKey = "operation-id",
        )!!

        assertEquals("Send report", request.title)
        assertEquals(listOf("work"), request.tags)
        assertEquals("high", request.priority)
        assertNull(request.dueDate)
    }

    @Test
    fun `blank title or operation key is rejected`() {
        assertNull(
            QuickAddRequestFactory.create(
                title = "  ",
                idempotencyKey = "operation-id",
            )
        )
        assertNull(
            QuickAddRequestFactory.create(
                title = "Task",
                idempotencyKey = "",
            )
        )
    }
}
