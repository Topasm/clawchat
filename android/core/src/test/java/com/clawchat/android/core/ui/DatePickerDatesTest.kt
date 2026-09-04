package com.clawchat.android.core.ui

import java.time.Instant
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Test

class DatePickerDatesTest {
    @Test
    fun `date picker millis are midnight UTC`() {
        val date = LocalDate.of(2026, 9, 4)

        assertEquals(Instant.parse("2026-09-04T00:00:00Z").toEpochMilli(), date.toDatePickerMillis())
    }

    @Test
    fun `date picker millis round trip without a device timezone`() {
        val date = LocalDate.of(2026, 1, 1)

        assertEquals(date, datePickerDate(date.toDatePickerMillis()))
    }
}
