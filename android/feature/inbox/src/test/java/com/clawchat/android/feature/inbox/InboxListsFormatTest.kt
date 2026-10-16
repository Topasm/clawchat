package com.clawchat.android.feature.inbox

import java.time.ZoneId
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class InboxListsFormatTest {
    private val seoul = ZoneId.of("Asia/Seoul")

    @Test fun `a due date reads as a short day on the phone's calendar`() {
        assertEquals("11월 3일", inboxShortDay("2030-11-02T15:00:00Z", Locale.KOREAN, seoul))
        assertEquals("Nov 3", inboxShortDay("2030-11-03T09:00:00Z", Locale.US, ZoneId.of("UTC")))
        assertEquals("Nov 3", inboxShortDay("2030-11-03", Locale.US, seoul))
        assertNull(inboxShortDay("soon", Locale.US, seoul))
    }

    @Test fun `only a classifier that was unsure marks a row`() {
        val routing = com.clawchat.android.core.data.model.InboxRouting(
            id = "r", origin = "auto", kind = "note", title = "Idea", originalTitle = "Idea", createdAt = "2030-11-01T09:00:00Z",
        )
        assertEquals(false, routing.isLowConfidence)
        assertEquals(true, routing.copy(kindConfidence = 0.62).isLowConfidence)
        assertEquals(false, routing.copy(kindConfidence = 0.8).isLowConfidence)
    }

    @Test fun `a vault folder is named by its last segment`() {
        assertEquals("Thesis", inboxFolderName("01_Projects/Thesis/"))
        assertNull(inboxFolderName(null))
    }
}
