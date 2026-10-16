package com.clawchat.android.widget.tracking

import com.clawchat.android.core.data.model.Note
import java.time.LocalDate
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
)
