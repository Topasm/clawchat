package com.clawchat.android.share

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.io.FileOutputStream
import java.nio.charset.StandardCharsets
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption.ATOMIC_MOVE
import java.nio.file.StandardCopyOption.REPLACE_EXISTING
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

internal const val SHARE_OUTBOX_MAX_ITEMS = 50
internal const val SHARE_OUTBOX_MAX_BYTES: Long = 200L * 1024 * 1024

@Serializable
internal enum class ShareOutboxStatus {
    PENDING,
    WAITING_FOR_CONNECTION,
    RETRYING,
    DIRECT_CONNECTION_REQUIRED,
    FAILED_PERMANENT,
}

@Serializable
internal data class ShareOutboxAttachment(
    val storedName: String,
    val displayName: String,
    val mimeType: String,
    val sizeBytes: Long,
    val idempotencyKey: String,
    val uploaded: Boolean = false,
)

@Serializable
internal data class ShareOutboxItem(
    val captureId: String,
    val title: String,
    val description: String? = null,
    val targetScope: String? = null,
    val attachments: List<ShareOutboxAttachment> = emptyList(),
    val rejectedFileCount: Int = 0,
    val taskId: String? = null,
    val status: ShareOutboxStatus = ShareOutboxStatus.PENDING,
    val attemptCount: Int = 0,
    val lastError: String? = null,
    val createdAtEpochMillis: Long,
    val updatedAtEpochMillis: Long,
)

internal sealed interface ShareOutboxEnqueueResult {
    data class Enqueued(val item: ShareOutboxItem) : ShareOutboxEnqueueResult
    data object Empty : ShareOutboxEnqueueResult
    data object QueueFull : ShareOutboxEnqueueResult
    data object Failed : ShareOutboxEnqueueResult
}

/** Atomic manifest + private files store used as the share queue source of truth. */
@Singleton
internal class ShareOutboxStore internal constructor(
    private val root: File,
    private val maxItems: Int,
    private val maxBytes: Long,
) {
    @Inject
    internal constructor(
        @ApplicationContext context: Context,
    ) : this(
        root = File(context.filesDir, OUTBOX_DIRECTORY),
        maxItems = SHARE_OUTBOX_MAX_ITEMS,
        maxBytes = SHARE_OUTBOX_MAX_BYTES,
    )

    private val mutex = Mutex()
    private val json = Json {
        encodeDefaults = true
        ignoreUnknownKeys = true
    }

    suspend fun enqueue(
        captureId: String,
        staged: StagedShare,
        targetScope: String?,
        nowEpochMillis: Long = System.currentTimeMillis(),
    ): ShareOutboxEnqueueResult = mutex.withLock {
        if (runCatching { UUID.fromString(captureId) }.isFailure) {
            return@withLock ShareOutboxEnqueueResult.Failed
        }
        val title = ShareCapturePolicy.taskTitle(
            staged.subject,
            staged.text,
            staged.files.map(StagedSharedFile::displayName),
        ) ?: return@withLock ShareOutboxEnqueueResult.Empty
        ensureRoot()

        val existingDirectory = itemDirectory(captureId)
        if (existingDirectory.isDirectory) {
            return@withLock readItem(existingDirectory)
                ?.let(ShareOutboxEnqueueResult::Enqueued)
                ?: ShareOutboxEnqueueResult.Failed
        }

        val queuedDirectories = durableItemDirectories()
        val incomingBytes = staged.files.sumOf { it.file.length() } +
            title.toByteArray().size +
            (staged.text?.toByteArray()?.size ?: 0)
        val queuedBytes = queuedDirectories.sumOf(::directorySize)
        if (queuedDirectories.size >= maxItems || incomingBytes > maxBytes - queuedBytes) {
            return@withLock ShareOutboxEnqueueResult.QueueFull
        }

        val temporaryDirectory = File(root, ".tmp-$captureId")
        temporaryDirectory.deleteRecursively()
        if (!temporaryDirectory.mkdirs()) return@withLock ShareOutboxEnqueueResult.Failed

        try {
            val attachments = staged.files.mapIndexed { index, stagedFile ->
                val extension = stagedFile.displayName.substringAfterLast('.', "bin")
                val storedName = "${UUID.randomUUID()}.$extension"
                val target = File(temporaryDirectory, storedName)
                stagedFile.file.inputStream().use { input ->
                    FileOutputStream(target).use { output ->
                        input.copyTo(output)
                        output.fd.sync()
                    }
                }
                ShareOutboxAttachment(
                    storedName = storedName,
                    displayName = stagedFile.displayName,
                    mimeType = stagedFile.mimeType,
                    sizeBytes = target.length(),
                    idempotencyKey = UUID.nameUUIDFromBytes(
                        "$captureId:attachment-$index".toByteArray(StandardCharsets.UTF_8),
                    ).toString(),
                )
            }
            val item = ShareOutboxItem(
                captureId = captureId,
                title = title,
                description = ShareCapturePolicy.taskDescription(staged.subject, staged.text),
                targetScope = targetScope,
                attachments = attachments,
                rejectedFileCount = staged.rejectedFileCount,
                createdAtEpochMillis = nowEpochMillis,
                updatedAtEpochMillis = nowEpochMillis,
            )
            writeManifest(temporaryDirectory, item)
            moveAtomically(temporaryDirectory, existingDirectory)
            ShareOutboxEnqueueResult.Enqueued(item)
        } catch (cancelled: CancellationException) {
            temporaryDirectory.deleteRecursively()
            throw cancelled
        } catch (_: Exception) {
            temporaryDirectory.deleteRecursively()
            ShareOutboxEnqueueResult.Failed
        }
    }

    suspend fun listProcessable(): List<ShareOutboxItem> = mutex.withLock {
        ensureRoot()
        durableItemDirectories()
            .mapNotNull(::readItem)
            .filter { it.status != ShareOutboxStatus.FAILED_PERMANENT }
            .sortedBy(ShareOutboxItem::createdAtEpochMillis)
    }

    suspend fun update(item: ShareOutboxItem): Boolean = mutex.withLock {
        val directory = itemDirectory(item.captureId)
        if (!directory.isDirectory) return@withLock false
        runCatching { writeManifest(directory, item) }.isSuccess
    }

    suspend fun discard(captureId: String): Boolean = mutex.withLock {
        if (runCatching { UUID.fromString(captureId) }.isFailure) return@withLock false
        val directory = itemDirectory(captureId)
        !directory.exists() || directory.deleteRecursively()
    }

    fun attachmentFile(item: ShareOutboxItem, attachment: ShareOutboxAttachment): File? {
        val directory = itemDirectory(item.captureId)
        val file = File(directory, attachment.storedName)
        val safe = runCatching {
            file.canonicalPath.startsWith(directory.canonicalPath + File.separator)
        }.getOrDefault(false)
        return file.takeIf { safe && it.isFile && it.length() == attachment.sizeBytes }
    }

    private fun ensureRoot() {
        root.mkdirs()
        // A temp directory has no durable manifest and can only be left by a
        // process death during the atomic enqueue transaction.
        root.listFiles()
            ?.filter { it.isDirectory && it.name.startsWith(".tmp-") }
            ?.filter { System.currentTimeMillis() - it.lastModified() > TEMP_MAX_AGE_MS }
            ?.forEach(File::deleteRecursively)
    }

    private fun durableItemDirectories(): List<File> = root.listFiles()
        ?.filter { it.isDirectory && !it.name.startsWith(".tmp-") }
        .orEmpty()

    private fun itemDirectory(captureId: String): File = File(root, captureId)

    private fun readItem(directory: File): ShareOutboxItem? = runCatching {
        json.decodeFromString<ShareOutboxItem>(File(directory, MANIFEST_FILE).readText())
    }.getOrNull()

    private fun writeManifest(directory: File, item: ShareOutboxItem) {
        val manifest = File(directory, MANIFEST_FILE)
        val temporary = File(directory, "$MANIFEST_FILE.tmp")
        FileOutputStream(temporary).use { output ->
            output.write(json.encodeToString(item).toByteArray(StandardCharsets.UTF_8))
            output.fd.sync()
        }
        moveAtomically(temporary, manifest)
    }

    private fun moveAtomically(source: File, target: File) {
        try {
            Files.move(source.toPath(), target.toPath(), ATOMIC_MOVE, REPLACE_EXISTING)
        } catch (_: AtomicMoveNotSupportedException) {
            // Both paths are always in the app-private files directory. Some
            // Android filesystems do not advertise atomic moves, so retain a
            // replace fallback rather than dropping a successfully staged
            // capture.
            Files.move(source.toPath(), target.toPath(), REPLACE_EXISTING)
        }
    }

    private fun directorySize(directory: File): Long = directory.walkTopDown()
        .filter(File::isFile)
        .sumOf(File::length)

    private companion object {
        const val OUTBOX_DIRECTORY = "share-outbox"
        const val MANIFEST_FILE = "manifest.json"
        const val TEMP_MAX_AGE_MS = 60L * 60 * 1000
    }
}
