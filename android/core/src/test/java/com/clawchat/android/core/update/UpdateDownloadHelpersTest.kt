package com.clawchat.android.core.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class UpdateDownloadHelpersTest {

    private val digest = "9f".repeat(32)

    @Test
    fun `reads the digest out of a sha256sum line`() {
        assertEquals(digest, parseChecksum("$digest  ClawChat-0.2.0.apk\n"))
        assertEquals(digest, parseChecksum("$digest *ClawChat-0.2.0.apk"))
        assertEquals(digest, parseChecksum("  $digest  \n"))
    }

    @Test
    fun `rejects a payload that is not a digest`() {
        assertNull(parseChecksum(""))
        assertNull(parseChecksum("<html>404</html>"))
        assertNull(parseChecksum("zz".repeat(32)))
        assertNull(parseChecksum(digest.dropLast(1)))
    }

    @Test
    fun `strips path separators out of an asset name`() {
        assertEquals("ClawChat-0.2.0.apk", sanitizeFileName("ClawChat-0.2.0.apk"))
        assertEquals("evil.apk", sanitizeFileName("../../etc/evil.apk"))
        assertEquals("clawchat-update.apk", sanitizeFileName("   "))
    }
}
