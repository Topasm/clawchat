package com.clawchat.android.share

import android.content.Intent
import android.net.Uri
import io.mockk.every
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ShareIntentParserTest {
    @Test
    fun `malformed single stream Parcelable fails closed`() {
        val intent = mockk<Intent>()
        every { intent.action } returns Intent.ACTION_SEND
        every { intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM) } throws
            ClassCastException("invalid Parcelable stream")

        assertEquals(ShareIntentParseResult.Malformed, ShareIntentParser.parse(intent))
    }

    @Test
    fun `malformed stream list fails closed without accepting its text`() {
        val intent = mockk<Intent>()
        every { intent.action } returns Intent.ACTION_SEND_MULTIPLE
        every { intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM) } throws
            ClassCastException("not a Uri list")

        assertEquals(ShareIntentParseResult.Malformed, ShareIntentParser.parse(intent))
    }

    @Test
    fun `plain shared URL is accepted without a stream`() {
        val intent = mockk<Intent>()
        every { intent.action } returns Intent.ACTION_SEND
        every { intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM) } returns null
        every { intent.clipData } returns null
        every { intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT) } returns null
        every { intent.getCharSequenceExtra(Intent.EXTRA_TEXT) } returns
            "https://example.com/article"
        every { intent.type } returns "text/plain"

        val result = ShareIntentParser.parse(intent)

        assertTrue(result is ShareIntentParseResult.Accepted)
        result as ShareIntentParseResult.Accepted
        assertEquals("https://example.com/article", result.payload.text)
        assertEquals(emptyList<Uri>(), result.payload.streams)
    }
}
