package com.clawchat.android.share

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

internal data class StagedSharedFile(
    val file: File,
    val displayName: String,
    val mimeType: String,
)

internal data class StagedShare(
    val subject: String?,
    val text: String?,
    val files: List<StagedSharedFile>,
    val rejectedFileCount: Int,
    val directory: File,
) {
    fun cleanUp() {
        directory.deleteRecursively()
    }
}

private data class SharedUriMetadata(
    val displayName: String?,
    val size: Long?,
)

/** Copies transient share URIs into a bounded, private cache before upload. */
@Singleton
internal class ShareContentStager @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    suspend fun stage(payload: IncomingSharePayload): StagedShare = withContext(Dispatchers.IO) {
        val shareRoot = File(context.cacheDir, "shared-capture").apply { mkdirs() }
        cleanStaleDirectories(shareRoot)
        val captureDirectory = File(shareRoot, UUID.randomUUID().toString()).apply { mkdirs() }
        val stagedFiles = mutableListOf<StagedSharedFile>()
        var rejectedCount = (payload.streams.size - MAX_SHARED_FILES).coerceAtLeast(0)
        var totalBytes = 0L

        payload.streams.take(MAX_SHARED_FILES).forEachIndexed { index, uri ->
            val staged = try {
                stageOne(
                    resolver = context.contentResolver,
                    uri = uri,
                    declaredMimeType = payload.declaredMimeType,
                    index = index + 1,
                    directory = captureDirectory,
                    remainingTotalBytes = MAX_SHARED_TOTAL_BYTES - totalBytes,
                )
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                // Content providers are outside our trust boundary. Reject a
                // failing URI without losing the rest of a multi-share.
                null
            }

            if (staged == null) {
                rejectedCount += 1
            } else {
                totalBytes += staged.file.length()
                stagedFiles += staged
            }
        }

        StagedShare(
            subject = payload.subject,
            text = payload.text,
            files = stagedFiles,
            rejectedFileCount = rejectedCount,
            directory = captureDirectory,
        )
    }

    private fun stageOne(
        resolver: ContentResolver,
        uri: Uri,
        declaredMimeType: String?,
        index: Int,
        directory: File,
        remainingTotalBytes: Long,
    ): StagedSharedFile? {
        // ACTION_SEND grants are intentionally transient. Copy now instead of
        // taking a persistable grant, which is reserved for OPEN_DOCUMENT URIs.
        if (uri.scheme != ContentResolver.SCHEME_CONTENT) return null

        val metadata = queryMetadata(resolver, uri)
        val mimeType = resolver.getType(uri) ?: declaredMimeType
        val validation = ShareCapturePolicy.validateFile(
            rawDisplayName = metadata.displayName,
            rawMimeType = mimeType,
            reportedSize = metadata.size,
            fallbackIndex = index,
        )
        val validated = (validation as? SharedFileValidation.Accepted)?.file ?: return null
        if (remainingTotalBytes <= 0L) return null

        val output = File(directory, "${UUID.randomUUID()}.${validated.extension}")
        return try {
            val copiedBytes = copyBounded(
                resolver = resolver,
                uri = uri,
                output = output,
                perFileLimit = MAX_SHARED_FILE_BYTES,
                totalRemaining = remainingTotalBytes,
            )
            if (copiedBytes <= 0L) {
                output.delete()
                null
            } else {
                StagedSharedFile(
                    file = output,
                    displayName = validated.displayName,
                    mimeType = validated.mimeType,
                )
            }
        } catch (_: IOException) {
            output.delete()
            null
        } catch (_: SecurityException) {
            output.delete()
            null
        }
    }

    private fun queryMetadata(resolver: ContentResolver, uri: Uri): SharedUriMetadata {
        var name: String? = null
        var size: Long? = null
        resolver.query(
            uri,
            arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
            null,
            null,
            null,
        )?.use { cursor ->
            if (cursor.moveToFirst()) {
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (nameIndex >= 0 && !cursor.isNull(nameIndex)) name = cursor.getString(nameIndex)
                if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) {
                    size = cursor.getLong(sizeIndex).takeIf { it >= 0L }
                }
            }
        }
        return SharedUriMetadata(name, size)
    }

    private fun copyBounded(
        resolver: ContentResolver,
        uri: Uri,
        output: File,
        perFileLimit: Long,
        totalRemaining: Long,
    ): Long {
        val input = resolver.openInputStream(uri) ?: throw IOException("Unable to open shared URI")
        var total = 0L
        input.use { source ->
            FileOutputStream(output).use { target ->
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                while (true) {
                    val count = source.read(buffer)
                    if (count < 0) break
                    total += count
                    if (total > perFileLimit || total > totalRemaining) {
                        throw IOException("Shared file exceeds capture limit")
                    }
                    target.write(buffer, 0, count)
                }
            }
        }
        return total
    }

    private fun cleanStaleDirectories(root: File) {
        val cutoff = System.currentTimeMillis() - STALE_CAPTURE_AGE_MS
        root.listFiles()
            ?.filter { it.isDirectory && it.lastModified() < cutoff }
            ?.forEach(File::deleteRecursively)
    }

    private companion object {
        const val STALE_CAPTURE_AGE_MS = 24L * 60 * 60 * 1000
    }
}
