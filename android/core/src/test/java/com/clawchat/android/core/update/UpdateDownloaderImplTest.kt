package com.clawchat.android.core.update

import android.content.Context
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException
import java.security.MessageDigest

class UpdateDownloaderImplTest {

    @get:Rule
    val temporaryFolder = TemporaryFolder()

    private lateinit var server: MockWebServer
    private lateinit var cacheDirectory: File
    private lateinit var downloader: UpdateDownloaderImpl

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        cacheDirectory = temporaryFolder.newFolder("cache")
        val context = mockk<Context>()
        every { context.cacheDir } returns cacheDirectory
        downloader = UpdateDownloaderImpl(context, OkHttpClient())
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `checksum HTTP error fails closed and deletes the staged APK`() = runTest {
        server.enqueue(MockResponse().setBody(APK_BYTES.toString(Charsets.UTF_8)))
        server.enqueue(MockResponse().setResponseCode(503).setBody("unavailable"))

        val error = downloadFailure()

        assertEquals("Update checksum download failed: HTTP 503", error.message)
        assertStagingDirectoryIsEmpty()
        assertEquals("/ClawChat-1.4.5.apk", server.takeRequest().path)
        assertEquals("/ClawChat-1.4.5.apk.sha256", server.takeRequest().path)
    }

    @Test
    fun `malformed checksum payload fails closed and deletes the staged APK`() = runTest {
        server.enqueue(MockResponse().setBody(APK_BYTES.toString(Charsets.UTF_8)))
        server.enqueue(MockResponse().setBody("<html>not a checksum</html>"))

        val error = downloadFailure()

        assertEquals("Update checksum payload is invalid", error.message)
        assertStagingDirectoryIsEmpty()
    }

    @Test
    fun `digest mismatch fails closed and deletes the staged APK`() = runTest {
        server.enqueue(MockResponse().setBody(APK_BYTES.toString(Charsets.UTF_8)))
        server.enqueue(MockResponse().setBody("${"0".repeat(64)}  ClawChat-1.4.5.apk\n"))

        val error = downloadFailure()

        assertTrue(error.message.orEmpty().startsWith("Update checksum mismatch:"))
        assertStagingDirectoryIsEmpty()
    }

    @Test
    fun `matching checksum returns the verified staged APK`() = runTest {
        val digest = sha256(APK_BYTES)
        server.enqueue(MockResponse().setBody(APK_BYTES.toString(Charsets.UTF_8)))
        server.enqueue(MockResponse().setBody("$digest  ClawChat-1.4.5.apk\n"))
        val progress = mutableListOf<Pair<Long, Long>>()

        val file = downloader.download(update()) { downloaded, total ->
            progress += downloaded to total
        }

        assertTrue(file.exists())
        assertEquals("ClawChat-1.4.5.apk", file.name)
        assertArrayEquals(APK_BYTES, file.readBytes())
        assertEquals(0L to APK_BYTES.size.toLong(), progress.first())
        assertEquals(APK_BYTES.size.toLong() to APK_BYTES.size.toLong(), progress.last())
        assertEquals(listOf(file), stagingFiles())
        assertFalse(file.isDirectory)
    }

    private suspend fun downloadFailure(): IOException = try {
        downloader.download(update()) { _, _ -> }
        throw AssertionError("Expected the update download to fail")
    } catch (error: IOException) {
        error
    }

    private fun update() = AvailableUpdate(
        version = "1.4.5",
        tag = "clawchat-v1.4.5",
        fileName = "ClawChat-1.4.5.apk",
        downloadUrl = server.url("/ClawChat-1.4.5.apk").toString(),
        sizeBytes = APK_BYTES.size.toLong(),
        checksumUrl = server.url("/ClawChat-1.4.5.apk.sha256").toString(),
        releaseNotes = "",
        releaseUrl = null,
    )

    private fun assertStagingDirectoryIsEmpty() {
        assertTrue(File(cacheDirectory, "updates").isDirectory)
        assertTrue(stagingFiles().isEmpty())
    }

    private fun stagingFiles(): List<File> =
        File(cacheDirectory, "updates").listFiles()?.toList().orEmpty()

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256")
            .digest(bytes)
            .joinToString("") { "%02x".format(it) }

    private companion object {
        val APK_BYTES = "signed-apk-test-payload".toByteArray()
    }
}
