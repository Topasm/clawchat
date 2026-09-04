package com.clawchat.android.core.ui

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * Material date pickers represent a calendar day as midnight UTC. Keeping the
 * conversion in UTC prevents the selected day from moving across a date
 * boundary on devices east or west of Greenwich.
 */
fun LocalDate.toDatePickerMillis(): Long =
    atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()

fun datePickerDate(millis: Long): LocalDate =
    Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate()
