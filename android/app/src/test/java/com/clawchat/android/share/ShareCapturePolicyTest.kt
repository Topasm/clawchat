package com.clawchat.android.share

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ShareCapturePolicyTest {
    @Test
    fun `an allowed image is sanitized and accepted`() {
        val result = ShareCapturePolicy.validateFile(
            rawDisplayName = "../../trip\u0000photo.jpg",
            rawMimeType = "image/jpeg",
            reportedSize = 2_048,
            fallbackIndex = 1,
        )

        assertEquals(
            ValidatedSharedFile(
                displayName = "trip_photo.jpg",
                extension = "jpg",
                mimeType = "image/jpeg",
            ),
            (result as SharedFileValidation.Accepted).file,
        )
    }

    @Test
    fun `a provider without a display name gets a safe name from mime type`() {
        val result = ShareCapturePolicy.validateFile(
            rawDisplayName = null,
            rawMimeType = "image/png",
            reportedSize = null,
            fallbackIndex = 2,
        )

        assertEquals(
            "shared-2.png",
            (result as SharedFileValidation.Accepted).file.displayName,
        )
    }

    @Test
    fun `long display names keep their extension after truncation`() {
        val result = ShareCapturePolicy.validateFile(
            rawDisplayName = "a".repeat(200) + ".jpg",
            rawMimeType = "image/jpeg",
            reportedSize = 10,
            fallbackIndex = 1,
        )

        val name = (result as SharedFileValidation.Accepted).file.displayName
        assertEquals(120, name.length)
        assertTrue(name.endsWith(".jpg"))
    }

    @Test
    fun `generic mime is allowed only because the extension is allowlisted`() {
        val result = ShareCapturePolicy.validateFile(
            rawDisplayName = "paper.pdf",
            rawMimeType = "application/octet-stream",
            reportedSize = 10,
            fallbackIndex = 1,
        )

        assertTrue(result is SharedFileValidation.Accepted)
        assertEquals(
            "application/pdf",
            (result as SharedFileValidation.Accepted).file.mimeType,
        )
    }

    @Test
    fun `mime and extension mismatch is rejected`() {
        val result = ShareCapturePolicy.validateFile(
            rawDisplayName = "renamed.jpg",
            rawMimeType = "application/pdf",
            reportedSize = 10,
            fallbackIndex = 1,
        )

        assertEquals(SharedFileValidation.MimeTypeMismatch, result)
    }

    @Test
    fun `unknown extensions and oversized files are rejected`() {
        assertEquals(
            SharedFileValidation.UnsupportedType,
            ShareCapturePolicy.validateFile("payload.exe", null, 10, 1),
        )
        assertEquals(
            SharedFileValidation.TooLarge,
            ShareCapturePolicy.validateFile(
                "archive.zip",
                "application/zip",
                MAX_SHARED_FILE_BYTES + 1,
                1,
            ),
        )
    }

    @Test
    fun `subject takes precedence and shared body is retained as description`() {
        assertEquals(
            "Read this later",
            ShareCapturePolicy.taskTitle(
                subject = "Read this later",
                text = "https://example.com/article",
                fileNames = emptyList(),
            ),
        )
        assertEquals(
            "https://example.com/article",
            ShareCapturePolicy.taskDescription(
                subject = "Read this later",
                text = "https://example.com/article",
            ),
        )
    }

    @Test
    fun `a plain URL becomes the task title without duplicate description`() {
        val url = "https://example.com/article"

        assertEquals(url, ShareCapturePolicy.taskTitle(null, url, emptyList()))
        assertNull(ShareCapturePolicy.taskDescription(null, url))
    }

    @Test
    fun `file only shares use a concise task title`() {
        assertEquals(
            "diagram.png",
            ShareCapturePolicy.taskTitle(null, null, listOf("diagram.png")),
        )
        assertEquals(
            "3 shared files",
            ShareCapturePolicy.taskTitle(
                null,
                null,
                listOf("one.png", "two.pdf", "three.md"),
            ),
        )
        assertEquals(
            "공유 파일 3개",
            ShareCapturePolicy.taskTitle(
                null,
                null,
                listOf("one.png", "two.pdf", "three.md"),
                multipleFilesTitle = { count -> "공유 파일 ${count}개" },
            ),
        )
    }
}
