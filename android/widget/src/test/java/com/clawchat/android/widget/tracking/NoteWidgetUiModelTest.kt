package com.clawchat.android.widget.tracking

import com.clawchat.android.core.data.model.Note
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class NoteWidgetUiModelTest {

    private fun note(id: String, content: String, updatedAt: String = "2026-10-15T09:00:00Z") =
        Note(id = id, content = content, createdAt = updatedAt, updatedAt = updatedAt)

    @Test
    fun `each note is named by its first written line`() {
        val result = NoteWidgetUiModel.from(
            listOf(
                note("a", "\n  선택지 만드는 모델  \nsecond line"),
                note("blank", "   \n\n"),
                note("a", "duplicate"),
            ),
            deviceZone = ZoneId.of("Asia/Seoul"),
        )

        assertEquals(listOf("선택지 만드는 모델"), result.items.map { it.headline })
        // 09:00 UTC is 18:00 in Seoul, still the same day.
        assertEquals(LocalDate.of(2026, 10, 15), result.items.single().updatedOn)
    }

    @Test
    fun `only the newest notes are kept`() {
        val result = NoteWidgetUiModel.from((1..40).map { note("n$it", "Note $it") })

        assertEquals(NoteWidgetUiModel.MAX_ROWS, result.items.size)
        assertEquals("n1", result.items.first().id)
    }

    @Test
    fun `a note from today shows its time, an older one its day`() {
        val today = LocalDate.of(2026, 10, 18)
        fun item(updatedAt: String) =
            NoteWidgetUiModel.from(listOf(note("n", "Note", updatedAt)), ZoneId.of("UTC")).items.single()

        assertEquals(NoteAge.TIME, noteAge(item("2026-10-18T08:59:30Z"), today))
        assertEquals(NoteAge.TIME, noteAge(item("2026-10-18T06:00:00Z"), today))
        assertEquals(NoteAge.DATE, noteAge(item("2026-10-15T09:00:00Z"), today))
        // A day without a readable moment still says it was today.
        assertEquals(
            NoteAge.TODAY,
            noteAge(NoteWidgetItem(id = "n", headline = "Note", updatedOn = today), today),
        )
    }
}
