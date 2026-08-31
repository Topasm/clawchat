package com.clawchat.android.feature.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId

class ChatTimeFormattingTest {

    @Test
    fun `instant timestamps display in the requested device timezone`() {
        val displayTime = parseDisplayDateTime(
            isoTimestamp = "2026-08-29T23:30:00Z",
            deviceZone = ZoneId.of("Asia/Seoul"),
        )

        assertEquals(LocalDate.of(2026, 8, 30), displayTime?.toLocalDate())
        assertEquals(LocalTime.of(8, 30), displayTime?.toLocalTime())
    }

    @Test
    fun `local timestamp keeps its wall time in the device timezone`() {
        val seoul = ZoneId.of("Asia/Seoul")
        val displayTime = parseDisplayDateTime(
            isoTimestamp = "2026-08-29T23:30:00",
            deviceZone = seoul,
        )

        assertEquals(LocalDateTime.of(2026, 8, 29, 23, 30), displayTime?.toLocalDateTime())
        assertEquals(seoul, displayTime?.zone)
    }

    @Test
    fun `invalid timestamp has no display time`() {
        assertNull(parseDisplayDateTime("not-a-timestamp", ZoneId.of("Asia/Seoul")))
    }
}
