package com.clawchat.android.widget.quickadd

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class QuickAddRequestFactoryTest {

    @Test
    fun `today target trims title and applies todays due date`() {
        val request = QuickAddRequestFactory.create(
            title = "  Send report  ",
            target = QuickAddTarget.TODAY,
            idempotencyKey = "operation-id",
            today = LocalDate.of(2026, 8, 31),
        )!!

        assertEquals("Send report", request.title)
        assertEquals("2026-08-31", request.dueDate)
        assertEquals("none", request.inboxState)
        assertEquals("android_widget", request.source)
        assertEquals("operation-id", request.idempotencyKey)
    }

    @Test
    fun `inbox target creates a captured item without due date`() {
        val request = QuickAddRequestFactory.create(
            title = "Capture this",
            target = QuickAddTarget.INBOX,
            idempotencyKey = "operation-id",
        )!!

        assertNull(request.dueDate)
        assertEquals("captured", request.inboxState)
    }

    @Test
    fun `blank title or operation key is rejected`() {
        assertNull(
            QuickAddRequestFactory.create(
                title = "  ",
                target = QuickAddTarget.TODAY,
                idempotencyKey = "operation-id",
            )
        )
        assertNull(
            QuickAddRequestFactory.create(
                title = "Task",
                target = QuickAddTarget.TODAY,
                idempotencyKey = "",
            )
        )
    }

    @Test
    fun `missing target extra remains backwards compatible with inbox`() {
        assertEquals(QuickAddTarget.INBOX, QuickAddTarget.fromWireValue(null))
        assertEquals(QuickAddTarget.INBOX, QuickAddTarget.fromWireValue("unknown"))
        assertEquals(QuickAddTarget.TODAY, QuickAddTarget.fromWireValue("today"))
    }
}
