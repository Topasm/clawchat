package com.clawchat.android.share

import android.content.ContentResolver
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.provider.OpenableColumns
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.ByteArrayInputStream
import java.nio.file.Files

class ShareContentStagerTest {
    @Test
    fun `content uri is copied into private cache without persisting its grant`() = runTest {
        val payload = "image bytes".toByteArray()
        val root = Files.createTempDirectory("clawchat-share-test").toFile()
        val context = mockk<Context>()
        val resolver = mockk<ContentResolver>()
        val uri = mockk<Uri>()
        every { context.cacheDir } returns root
        every { context.contentResolver } returns resolver
        every { uri.scheme } returns ContentResolver.SCHEME_CONTENT
        every { uri.toString() } returns "content://provider/photo"
        every { resolver.getType(uri) } returns "image/png"
        every { resolver.query(uri, any(), null, null, null) } returns metadataCursor(
            displayName = "photo.png",
            size = payload.size.toLong(),
        )
        every { resolver.openInputStream(uri) } returns ByteArrayInputStream(payload)

        val staged = ShareContentStager(context).stage(
            IncomingSharePayload(null, null, listOf(uri), "image/*"),
        )

        assertEquals(0, staged.rejectedFileCount)
        assertEquals("photo.png", staged.files.single().displayName)
        assertArrayEquals(payload, staged.files.single().file.readBytes())
        verify(exactly = 0) { resolver.takePersistableUriPermission(any(), any()) }

        val directory = staged.directory
        staged.cleanUp()
        assertFalse(directory.exists())
        root.deleteRecursively()
    }

    @Test
    fun `reported oversized content is rejected before its stream is opened`() = runTest {
        val root = Files.createTempDirectory("clawchat-share-test").toFile()
        val context = mockk<Context>()
        val resolver = mockk<ContentResolver>()
        val uri = mockk<Uri>()
        every { context.cacheDir } returns root
        every { context.contentResolver } returns resolver
        every { uri.scheme } returns ContentResolver.SCHEME_CONTENT
        every { uri.toString() } returns "content://provider/large"
        every { resolver.getType(uri) } returns "application/pdf"
        every { resolver.query(uri, any(), null, null, null) } returns metadataCursor(
            displayName = "large.pdf",
            size = MAX_SHARED_FILE_BYTES + 1,
        )

        val staged = ShareContentStager(context).stage(
            IncomingSharePayload(null, null, listOf(uri), "application/pdf"),
        )

        assertEquals(1, staged.rejectedFileCount)
        assertEquals(emptyList<StagedSharedFile>(), staged.files)
        verify(exactly = 0) { resolver.openInputStream(any()) }
        staged.cleanUp()
        root.deleteRecursively()
    }

    private fun metadataCursor(displayName: String, size: Long): Cursor =
        mockk<Cursor>(relaxed = true).also { cursor ->
            every { cursor.moveToFirst() } returns true
            every { cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME) } returns 0
            every { cursor.getColumnIndex(OpenableColumns.SIZE) } returns 1
            every { cursor.isNull(0) } returns false
            every { cursor.isNull(1) } returns false
            every { cursor.getString(0) } returns displayName
            every { cursor.getLong(1) } returns size
        }
}
