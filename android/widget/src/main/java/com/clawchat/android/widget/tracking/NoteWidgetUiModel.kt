package com.clawchat.android.widget.tracking

import com.clawchat.android.core.data.model.Note
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId

/** The notes tab: newest edits first, each reduced to the line that names it. */
internal data class NoteWidgetUiModel(
    val items: List<NoteWidgetItem>,
) : TrackingWidgetData {
    val isEmpty: Boolean
        get() = items.isEmpty()

    companion object {
        /** A glance at what was written lately, not the whole notebook. */
        const val MAX_ROWS = 20

        fun from(
            notes: List<Note>,
            deviceZone: ZoneId = ZoneId.systemDefault(),
        ): NoteWidgetUiModel = NoteWidgetUiModel(
            items = notes
                .distinctBy { it.id }
                // Server and local storage both list newest edits first.
                .mapNotNull { note ->
                    val headline = note.content.lineSequence()
                        .map(String::trim)
                        .firstOrNull(String::isNotEmpty)
                        ?: return@mapNotNull null
                    NoteWidgetItem(
                        id = note.id,
                        headline = headline,
                        updatedOn = widgetDueDate(note.updatedAt, deviceZone),
                        updatedAt = noteInstant(note.updatedAt),
                    )
                }
                .take(MAX_ROWS),
        )
    }
}

internal data class NoteWidgetItem(
    val id: String,
    /** First non-blank line of the note. */
    val headline: String,
    val updatedOn: LocalDate?,
    /** The exact moment, for the time a note from today shows; null when unreadable. */
    val updatedAt: Instant? = null,
)

private fun noteInstant(raw: String?): Instant? {
    val value = raw?.trim().orEmpty()
    if (value.isEmpty()) return null
    return runCatching { OffsetDateTime.parse(value).toInstant() }
        .recoverCatching { Instant.parse(value) }
        .getOrNull()
}

/**
 * How a note row dates itself: the time for today's notes, the day otherwise.
 * A widget is redrawn only every half hour or so, so a relative "5 min ago"
 * would go stale on screen; a time of day stays true until midnight.
 */
internal enum class NoteAge { TIME, TODAY, DATE }

internal fun noteAge(item: NoteWidgetItem, today: LocalDate): NoteAge = when {
    item.updatedOn != today -> NoteAge.DATE
    item.updatedAt != null -> NoteAge.TIME
    else -> NoteAge.TODAY
}
