package com.clawchat.android.share

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.util.UUID

class ShareOutboxStoreTest {
    @Test
    fun `queued files and delivery progress survive store reconstruction`() = runTest {
        val root = Files.createTempDirectory("clawchat-share-outbox").toFile()
        val staging = stage("paper body", rejected = 2)
        val captureId = UUID.randomUUID().toString()
        try {
            val firstStore = ShareOutboxStore(root, maxItems = 5, maxBytes = 1_000_000)
            val enqueued = firstStore.enqueue(captureId, staging, targetScope = "host-1")
                as ShareOutboxEnqueueResult.Enqueued

            assertEquals(2, enqueued.item.rejectedFileCount)
            assertTrue(staging.files.single().file.exists())
            val queuedFile = firstStore.attachmentFile(
                enqueued.item,
                enqueued.item.attachments.single(),
            )
            assertNotNull(queuedFile)
            assertEquals("paper body", queuedFile?.readText())

            val progressed = enqueued.item.copy(
                taskId = "todo-1",
                attachments = enqueued.item.attachments.map { it.copy(uploaded = true) },
                status = ShareOutboxStatus.RETRYING,
                attemptCount = 1,
                updatedAtEpochMillis = 2,
            )
            assertTrue(firstStore.update(progressed))

            val reconstructed = ShareOutboxStore(root, maxItems = 5, maxBytes = 1_000_000)
                .listProcessable()
                .single()
            assertEquals("todo-1", reconstructed.taskId)
            assertTrue(reconstructed.attachments.single().uploaded)
            assertEquals(1, reconstructed.attemptCount)
            assertNotNull(
                reconstructed.let {
                    ShareOutboxStore(root, 5, 1_000_000)
                        .attachmentFile(it, it.attachments.single())
                },
            )
        } finally {
            staging.cleanUp()
            root.deleteRecursively()
        }
    }

    @Test
    fun `files remain until the user explicitly discards the capture`() = runTest {
        val root = Files.createTempDirectory("clawchat-share-outbox").toFile()
        val staging = stage("keep me")
        val captureId = UUID.randomUUID().toString()
        try {
            val store = ShareOutboxStore(root, maxItems = 5, maxBytes = 1_000_000)
            val item = (store.enqueue(captureId, staging, null)
                as ShareOutboxEnqueueResult.Enqueued).item
            val queuedFile = store.attachmentFile(item, item.attachments.single())
            assertTrue(queuedFile?.exists() == true)

            assertTrue(store.update(item.copy(status = ShareOutboxStatus.FAILED_PERMANENT)))
            assertTrue(queuedFile?.exists() == true)
            assertTrue(File(root, captureId).isDirectory)

            assertTrue(store.discard(captureId))
            assertFalse(File(root, captureId).exists())
            assertFalse(queuedFile?.exists() == true)
        } finally {
            staging.cleanUp()
            root.deleteRecursively()
        }
    }

    @Test
    fun `item count quota rejects a new capture without changing the queue`() = runTest {
        val root = Files.createTempDirectory("clawchat-share-outbox").toFile()
        val first = stage("first")
        val second = stage("second")
        try {
            val store = ShareOutboxStore(root, maxItems = 1, maxBytes = 1_000_000)
            assertTrue(
                store.enqueue(UUID.randomUUID().toString(), first, null) is
                    ShareOutboxEnqueueResult.Enqueued,
            )
            assertEquals(
                ShareOutboxEnqueueResult.QueueFull,
                store.enqueue(UUID.randomUUID().toString(), second, null),
            )
            assertEquals(1, store.listProcessable().size)
        } finally {
            first.cleanUp()
            second.cleanUp()
            root.deleteRecursively()
        }
    }

    @Test
    fun `byte quota rejects a capture before copying it into durable storage`() = runTest {
        val root = Files.createTempDirectory("clawchat-share-outbox").toFile()
        val staging = stage("larger than quota")
        val captureId = UUID.randomUUID().toString()
        try {
            val store = ShareOutboxStore(root, maxItems = 5, maxBytes = 8)

            assertEquals(
                ShareOutboxEnqueueResult.QueueFull,
                store.enqueue(captureId, staging, null),
            )
            assertFalse(File(root, captureId).exists())
            assertTrue(staging.files.single().file.exists())
        } finally {
            staging.cleanUp()
            root.deleteRecursively()
        }
    }

    private fun stage(
        body: String,
        rejected: Int = 0,
    ): StagedShare {
        val directory = Files.createTempDirectory("clawchat-share-staging").toFile()
        val file = File(directory, "paper.txt").apply { writeText(body) }
        return StagedShare(
            subject = "Reference",
            text = null,
            files = listOf(StagedSharedFile(file, "paper.txt", "text/plain")),
            rejectedFileCount = rejected,
            directory = directory,
        )
    }
}
