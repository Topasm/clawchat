package com.clawchat.android.core.data.local

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import javax.inject.Inject
import javax.inject.Singleton

/** Reads the current device zone at the point an operation starts. */
@Singleton
class DeviceZoneProvider @Inject constructor() {
    fun current(): ZoneId = ZoneId.systemDefault()
}

data class StoredEventTime(
    val isoOffsetDateTime: String,
    val epochMillis: Long,
)

/**
 * Local event editors produce an offset-less wall time. Attach the device
 * offset before storage so background workers can recover the same instant.
 */
fun String.toStoredEventTime(zoneId: ZoneId): StoredEventTime {
    val offsetDateTime = runCatching { OffsetDateTime.parse(this) }.getOrNull()
        ?: runCatching { ZonedDateTime.parse(this).toOffsetDateTime() }.getOrNull()
        ?: runCatching { Instant.parse(this).atZone(zoneId).toOffsetDateTime() }.getOrNull()
        ?: runCatching { LocalDateTime.parse(this).atZone(zoneId).toOffsetDateTime() }.getOrNull()
        ?: runCatching { LocalDate.parse(this).atStartOfDay(zoneId).toOffsetDateTime() }.getOrNull()
        ?: throw IllegalArgumentException("Invalid local event time: $this")
    return StoredEventTime(
        isoOffsetDateTime = offsetDateTime.toString(),
        epochMillis = offsetDateTime.toInstant().toEpochMilli(),
    )
}

/** Local tasks have day-level due dates; normalize every accepted ISO form. */
fun String.toStoredDueDate(zoneId: ZoneId): String {
    val date = runCatching { LocalDate.parse(this) }.getOrNull()
        ?: runCatching { OffsetDateTime.parse(this).atZoneSameInstant(zoneId).toLocalDate() }.getOrNull()
        ?: runCatching { ZonedDateTime.parse(this).withZoneSameInstant(zoneId).toLocalDate() }.getOrNull()
        ?: runCatching { Instant.parse(this).atZone(zoneId).toLocalDate() }.getOrNull()
        ?: runCatching { LocalDateTime.parse(this).toLocalDate() }.getOrNull()
        ?: throw IllegalArgumentException("Invalid local task due date: $this")
    return date.toString()
}
