package com.clawchat.android.share

import com.clawchat.android.core.data.ActiveSession
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.repository.AttachmentRepository
import com.clawchat.android.core.data.repository.ShareAttachmentUploadResult
import com.clawchat.android.core.network.ApiResult
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.coVerifyOrder
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.util.UUID

class ShareOutboxProcessorTest {
    private val store = mockk<ShareOutboxStore>()
    private val sessionStore = mockk<SessionStore>()
    private val repository = mockk<AttachmentRepository>()
    private val notifier = mockk<ShareOutboxNotifier>(relaxed = true)
    private val processor = ShareOutboxProcessor(store, sessionStore, repository, notifier)

    @Test
    fun `logged out capture remains queued for retry`() = runTest {
        val item = item(targetScope = null)
        coEvery { store.listProcessable() } returns listOf(item)
        every { sessionStore.activeSession } returns MutableStateFlow(null)
        coEvery { store.update(any()) } returns true

        assertEquals(ShareOutboxRunResult.RETRY, processor.processAll())

        coVerify {
            store.update(
                match {
                    it.captureId == item.captureId &&
                        it.status == ShareOutboxStatus.WAITING_FOR_CONNECTION
                },
            )
        }
        coVerify(exactly = 0) { repository.createSharedTodo(any(), any()) }
        coVerify(exactly = 0) { store.discard(any()) }
    }

    @Test
    fun `pre-login capture binds workspace before idempotent todo creation`() = runTest {
        val item = item(targetScope = null)
        coEvery { store.listProcessable() } returns listOf(item)
        every { sessionStore.activeSession } returns MutableStateFlow(session("host-a"))
        coEvery { store.update(any()) } returns true
        coEvery { repository.createSharedTodo(any(), "host-a") } returns
            ApiResult.Success(Todo(id = "todo-1", title = "Shared"))
        coEvery { store.discard(item.captureId) } returns true

        assertEquals(ShareOutboxRunResult.SUCCESS, processor.processAll())

        coVerifyOrder {
            store.update(match { it.targetScope == "host-a" && it.taskId == null })
            repository.createSharedTodo(
                match { it.idempotencyKey == item.captureId },
                expectedScope = "host-a",
            )
            store.update(match { it.targetScope == "host-a" && it.taskId == "todo-1" })
            store.discard(item.captureId)
        }
        verify { notifier.saved(match { it.taskId == "todo-1" }) }
    }

    @Test
    fun `workspace switch blocks every network write and retains the capture`() = runTest {
        val item = item(targetScope = "host-a")
        coEvery { store.listProcessable() } returns listOf(item)
        every { sessionStore.activeSession } returns MutableStateFlow(session("host-b"))
        coEvery { store.update(any()) } returns true

        assertEquals(ShareOutboxRunResult.RETRY, processor.processAll())

        coVerify(exactly = 0) { repository.createSharedTodo(any(), any()) }
        coVerify(exactly = 0) {
            repository.uploadAttachment(any(), any(), any(), any(), any(), any())
        }
        coVerify(exactly = 0) { store.discard(any()) }
        verify { notifier.connectionRequired(match { it.targetScope == "host-a" }) }
    }

    @Test
    fun `relay oversized attachment is retained for a direct retry`() = runTest {
        val captureId = UUID.randomUUID().toString()
        val attachment = ShareOutboxAttachment(
            storedName = "stored.pdf",
            displayName = "paper.pdf",
            mimeType = "application/pdf",
            sizeBytes = 900_000,
            idempotencyKey = UUID.randomUUID().toString(),
        )
        val item = item(captureId, targetScope = "host-a").copy(
            taskId = "todo-1",
            attachments = listOf(attachment),
        )
        val file = File.createTempFile("clawchat-share-worker", ".pdf").apply {
            writeBytes(ByteArray(32))
            deleteOnExit()
        }
        coEvery { store.listProcessable() } returns listOf(item)
        every { sessionStore.activeSession } returns MutableStateFlow(session("host-a"))
        coEvery { store.update(any()) } returns true
        every { store.attachmentFile(any(), attachment) } returns file
        coEvery {
            repository.uploadAttachment(
                "todo-1",
                file,
                "paper.pdf",
                "application/pdf",
                attachment.idempotencyKey,
                "host-a",
            )
        } returns ShareAttachmentUploadResult.DirectConnectionRequired

        assertEquals(ShareOutboxRunResult.RETRY, processor.processAll())

        coVerify {
            store.update(
                match { it.status == ShareOutboxStatus.DIRECT_CONNECTION_REQUIRED },
            )
        }
        coVerify(exactly = 0) { store.discard(any()) }
        verify { notifier.directConnectionRequired(any()) }
        file.delete()
    }

    @Test
    fun `replacement cancellation retains the durable manifest and file`() = runTest {
        val root = Files.createTempDirectory("clawchat-share-cancel").toFile()
        val stagingDirectory = Files.createTempDirectory("clawchat-share-cancel-stage").toFile()
        val stagedFile = File(stagingDirectory, "notes.txt").apply { writeText("keep me") }
        val staged = StagedShare(
            subject = "Reference",
            text = null,
            files = listOf(StagedSharedFile(stagedFile, "notes.txt", "text/plain")),
            rejectedFileCount = 0,
            directory = stagingDirectory,
        )
        try {
            val realStore = ShareOutboxStore(root, maxItems = 5, maxBytes = 1_000_000)
            val captureId = UUID.randomUUID().toString()
            val queued = realStore.enqueue(captureId, staged, targetScope = "host-a")
                as ShareOutboxEnqueueResult.Enqueued
            val localSessionStore = mockk<SessionStore>()
            val localRepository = mockk<AttachmentRepository>()
            every { localSessionStore.activeSession } returns MutableStateFlow(session("host-a"))
            coEvery {
                localRepository.createSharedTodo(any(), "host-a")
            } throws CancellationException("unique work replaced")
            val localProcessor = ShareOutboxProcessor(
                realStore,
                localSessionStore,
                localRepository,
                mockk(relaxed = true),
            )

            val failure = runCatching { localProcessor.processAll() }.exceptionOrNull()

            assertTrue(failure is CancellationException)
            val retained = realStore.listProcessable().single()
            assertEquals(captureId, retained.captureId)
            assertTrue(
                realStore.attachmentFile(retained, retained.attachments.single())?.isFile == true,
            )
            assertTrue(root.resolve(captureId).isDirectory)
            assertEquals(queued.item.captureId, retained.captureId)
        } finally {
            staged.cleanUp()
            root.deleteRecursively()
        }
    }

    private fun session(hostId: String) = ActiveSession(
        token = "token-$hostId",
        apiBaseUrl = "https://$hostId.example",
        hostId = hostId,
        authMode = "paired",
    )

    private fun item(
        captureId: String = UUID.randomUUID().toString(),
        targetScope: String?,
    ) = ShareOutboxItem(
        captureId = captureId,
        title = "Shared",
        targetScope = targetScope,
        createdAtEpochMillis = 1,
        updatedAtEpochMillis = 1,
    )
}
