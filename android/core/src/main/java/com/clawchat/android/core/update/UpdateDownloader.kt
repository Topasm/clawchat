package com.clawchat.android.core.update

import android.content.Context
import com.clawchat.android.core.di.UpdateClient
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.coroutineContext

/** Downloads a release APK into app-private storage and verifies its digest. */
interface UpdateDownloader {
    /**
     * @param onProgress receives (downloadedBytes, totalBytes); totalBytes is 0
     *   while the server has not declared a length.
     * @throws IOException when the download fails or the digest does not match.
     */
    suspend fun download(
        update: AvailableUpdate,
        onProgress: (downloaded: Long, total: Long) -> Unit,
    ): File
}

@Singleton
class UpdateDownloaderImpl @Inject constructor(
    @param:ApplicationContext private val context: Context,
    @param:UpdateClient private val client: OkHttpClient,
) : UpdateDownloader {

    override suspend fun download(
        update: AvailableUpdate,
        onProgress: (downloaded: Long, total: Long) -> Unit,
    ): File = withContext(Dispatchers.IO) {
        val directory = File(context.cacheDir, UPDATE_DIRECTORY)
        if (!directory.isDirectory && !directory.mkdirs()) {
            throw IOException("Could not create the update cache directory")
        }
        // Only one staged APK is ever useful, and a stale one wastes cache the
        // system may reclaim mid-install.
        directory.listFiles()?.forEach { it.delete() }

        val target = File(directory, sanitizeFileName(update.fileName))
        try {
            writeBody(update, target, onProgress)
            val expected = fetchChecksum(update.checksumUrl)
            val actual = sha256(target)
            if (!actual.equals(expected, ignoreCase = true)) {
                throw IOException("Update checksum mismatch: expected $expected, got $actual")
            }
        } catch (error: Throwable) {
            target.delete()
            throw error
        }
        target
    }

    private suspend fun writeBody(
        update: AvailableUpdate,
        target: File,
        onProgress: (downloaded: Long, total: Long) -> Unit,
    ) {
        val request = Request.Builder()
            .url(update.downloadUrl)
            .header("Accept", "application/octet-stream")
            .build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IOException("Update download failed: HTTP ${response.code}")
            }
            val body = response.body
            val declared = body.contentLength()
            val total = if (declared > 0) declared else update.sizeBytes
            var downloaded = 0L
            onProgress(0L, total)
            body.byteStream().use { source ->
                target.outputStream().use { sink ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    while (true) {
                        coroutineContext.ensureActive()
                        val read = source.read(buffer)
                        if (read == -1) break
                        sink.write(buffer, 0, read)
                        downloaded += read
                        onProgress(downloaded, total)
                    }
                }
            }
        }
    }

    private fun fetchChecksum(url: String): String {
        val request = Request.Builder().url(url).build()
        return client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IOException("Update checksum download failed: HTTP ${response.code}")
            }
            parseChecksum(response.body.string())
                ?: throw IOException("Update checksum payload is invalid")
        }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { stream ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val read = stream.read(buffer)
                if (read == -1) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private companion object {
        const val UPDATE_DIRECTORY = "updates"
    }
}

/**
 * Reads the digest out of a `sha256sum` file (`<hex>  <file name>`); null when
 * the payload is not a digest line, which keeps a stray HTML error page from
 * passing as a checksum.
 */
fun parseChecksum(contents: String): String? {
    val token = contents.trim().lineSequence().firstOrNull()?.trim()?.substringBefore(' ')
    return token?.takeIf { it.length == 64 && it.all { char -> char.isDigit() || char in 'a'..'f' || char in 'A'..'F' } }
}

/** Strips any path separators a release asset name might carry. */
fun sanitizeFileName(name: String): String {
    val candidate = name.substringAfterLast('/').substringAfterLast('\\')
    return candidate.takeIf { it.isNotBlank() && it != "." && it != ".." } ?: "clawchat-update.apk"
}
