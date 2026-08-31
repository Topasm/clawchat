package com.clawchat.android.core.notification

import android.app.NotificationManager
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReminderNotificationHelperTest {
    @Test
    fun `disabled reminder channel cannot accept a notification`() {
        assertFalse(reminderChannelAllowsNotifications(NotificationManager.IMPORTANCE_NONE))
    }

    @Test
    fun `missing or enabled channel can accept a notification`() {
        assertTrue(reminderChannelAllowsNotifications(null))
        assertTrue(reminderChannelAllowsNotifications(NotificationManager.IMPORTANCE_HIGH))
    }

    @Test
    fun `exact keys separate daily recurring occurrences without a coarse window`() {
        val first = reminderDeliveryKey("event", "event-1@2026-08-31", 1_788_137_200)
        val next = reminderDeliveryKey("event", "event-1@2026-09-01", 1_788_223_600)

        assertTrue(first != next)
    }
}
