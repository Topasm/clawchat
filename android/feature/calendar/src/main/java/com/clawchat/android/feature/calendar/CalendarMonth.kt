package com.clawchat.android.feature.calendar

import android.text.format.DateFormat
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.YearMonth
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

/** Weeks a month grid always draws, so the grid height never jumps between months. */
const val CALENDAR_WEEK_COUNT = 6

/**
 * The dates a month grid shows, including the leading and trailing days that
 * fill out the first and last week. Always [CALENDAR_WEEK_COUNT] * 7 entries,
 * starting on [firstDayOfWeek].
 */
fun monthGrid(month: YearMonth, firstDayOfWeek: DayOfWeek): List<LocalDate> {
    val firstOfMonth = month.atDay(1)
    val lead = ((firstOfMonth.dayOfWeek.value - firstDayOfWeek.value) + 7) % 7
    val start = firstOfMonth.minusDays(lead.toLong())
    return (0 until CALENDAR_WEEK_COUNT * 7).map { start.plusDays(it.toLong()) }
}

/** Weekday headers in the same order [monthGrid] lays its cells out. */
fun weekdayLabels(firstDayOfWeek: DayOfWeek, locale: Locale = Locale.getDefault()): List<String> =
    (0 until 7).map { firstDayOfWeek.plus(it.toLong()).getDisplayName(TextStyle.NARROW, locale) }

/**
 * Reads an event timestamp. The server sends ISO-8601, with an offset when the
 * value carries one, and a date alone for some all-day rows; an unreadable
 * value returns null rather than dropping the whole month.
 */
fun parseEventDateTime(
    raw: String?,
    deviceZone: ZoneId = ZoneId.systemDefault(),
): LocalDateTime? {
    val value = raw?.trim().orEmpty()
    if (value.isEmpty()) return null
    return runCatching {
        ZonedDateTime.parse(value).withZoneSameInstant(deviceZone).toLocalDateTime()
    }
        .recoverCatching {
            OffsetDateTime.parse(value).atZoneSameInstant(deviceZone).toLocalDateTime()
        }
        .recoverCatching { LocalDateTime.parse(value) }
        .recoverCatching { LocalDate.parse(value.take(10)).atStartOfDay() }
        .getOrNull()
}

/** The day an event belongs to in the grid, or null when its start is unreadable. */
fun eventDate(
    startTime: String?,
    deviceZone: ZoneId = ZoneId.systemDefault(),
): LocalDate? = parseEventDateTime(startTime, deviceZone)?.toLocalDate()

private val TIME_FORMAT = DateTimeFormatter.ofPattern("HH:mm", Locale.ROOT)

/** Locale-correct field order for a date skeleton, e.g. `August 2026` / `2026년 8월`. */
fun localizedDateFormatter(locale: Locale, skeleton: String): DateTimeFormatter =
    DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, skeleton), locale)

/** Locale-correct clock format that also follows the device's 12/24-hour preference. */
fun localizedTimeFormatter(locale: Locale, is24Hour: Boolean): DateTimeFormatter =
    DateTimeFormatter.ofPattern(
        DateFormat.getBestDateTimePattern(locale, if (is24Hour) "Hm" else "hm"),
        locale,
    )

/** `09:00`, `09:00 – 10:30`, or `All day`. */
fun eventTimeLabel(
    startTime: String?,
    endTime: String?,
    isAllDay: Boolean,
    allDayLabel: String,
    timeFormatter: DateTimeFormatter = TIME_FORMAT,
): String {
    if (isAllDay) return allDayLabel
    val start = parseEventDateTime(startTime) ?: return ""
    val end = parseEventDateTime(endTime)
    val startLabel = start.format(timeFormatter)
    if (end == null) return startLabel
    return "$startLabel – ${end.format(timeFormatter)}"
}
