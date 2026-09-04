package com.clawchat.android.core.data.local

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

class LocalDateStorageTest {
    private val seoul = ZoneId.of("Asia/Seoul")

    @Test
    fun `offsetless local event time is stored with the device offset`() {
        val stored = "2026-08-31T09:00:00".toStoredEventTime(seoul)

        assertEquals("2026-08-31T09:00+09:00", stored.isoOffsetDateTime)
        assertEquals(Instant.parse("2026-08-31T00:00:00Z").toEpochMilli(), stored.epochMillis)
    }

    @Test
    fun `offset event input keeps its instant`() {
        val stored = "2026-08-31T09:00:00-04:00".toStoredEventTime(seoul)

        assertEquals(Instant.parse("2026-08-31T13:00:00Z").toEpochMilli(), stored.epochMillis)
    }

    @Test
    fun `instant due date is normalized to the device day`() {
        assertEquals("2026-09-01", "2026-08-31T15:30:00Z".toStoredDueDate(seoul))
    }
}
