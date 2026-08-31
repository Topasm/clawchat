package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.AttachmentApi
import com.clawchat.android.core.data.model.Attachment
import com.clawchat.android.core.data.model.ShareTodoCreate
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.DirectConnectionRequiredException
import com.clawchat.android.core.network.ExpectedSessionScope
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.test.runTest
import okhttp3.MultipartBody
import okio.Buffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.util.UUID

class AttachmentRepositoryTest {
    private val api = mockk<AttachmentApi>()
    private val repository = AttachmentRepository(api)
    private val idempotencyKey = UUID.randomUUID().toString()
    private val expectedScope = "host-a"

    @Test
    fun `todo creation carries capture id and expected workspace`() = runTest {
        val body = ShareTodoCreate(title = "Shared", idempotencyKey = idempotencyKey)
        coEvery {
            api.createSharedTodo(body, ExpectedSessionScope(expectedScope))
        } returns Todo(id = "todo-1", title = "Shared")

        val result = repository.createSharedTodo(body, expectedScope)

        assertEquals("todo-1", (result as ApiResult.Success).data.id)
        coVerify { api.createSharedTodo(body, ExpectedSessionScope(expectedScope)) }
    }

    @Test
    fun `upload streams staged file with idempotency and workspace tags`() = runTest {
        val part = slot<MultipartBody.Part>()
        coEvery {
            api.uploadAttachment(
                "todo-1",
                idempotencyKey,
                null,
                capture(part),
                ExpectedSessionScope(expectedScope),
            )
        } returns attachment()
        val file = File.createTempFile("clawchat-shared", ".txt").apply {
            writeText("shared body")
            deleteOnExit()
        }

        val result = repository.uploadAttachment(
            todoId = "todo-1",
            file = file,
            displayName = "notes.txt",
            mimeType = "text/plain",
            idempotencyKey = idempotencyKey,
            expectedScope = expectedScope,
        )

        assertTrue(result is ShareAttachmentUploadResult.Success)
        assertTrue(part.captured.headers?.get("Content-Disposition")?.contains("notes.txt") == true)
        assertEquals("text/plain", part.captured.body.contentType().toString())
        val sink = Buffer()
        part.captured.body.writeTo(sink)
        assertEquals("shared body", sink.readUtf8())
    }

    @Test
    fun `relay threshold leaves nested base64 headroom and marks only larger files direct`() = runTest {
        val safe = File.createTempFile("clawchat-relay-safe", ".bin").apply {
            RandomAccessFile(this, "rw").use {
                it.setLength(AttachmentRepository.RELAY_SAFE_ATTACHMENT_BYTES)
            }
            deleteOnExit()
        }
        val large = File.createTempFile("clawchat-relay-large", ".bin").apply {
            RandomAccessFile(this, "rw").use {
                it.setLength(AttachmentRepository.RELAY_SAFE_ATTACHMENT_BYTES + 1)
            }
            deleteOnExit()
        }
        coEvery {
            api.uploadAttachment(
                "todo-1",
                idempotencyKey,
                null,
                any(),
                ExpectedSessionScope(expectedScope),
            )
        } returns attachment()
        coEvery {
            api.uploadAttachment(
                "todo-1",
                idempotencyKey,
                "true",
                any(),
                ExpectedSessionScope(expectedScope),
            )
        } returns attachment()

        repository.uploadAttachment(
            "todo-1", safe, "safe.bin", "application/octet-stream",
            idempotencyKey, expectedScope,
        )
        repository.uploadAttachment(
            "todo-1", large, "large.bin", "application/octet-stream",
            idempotencyKey, expectedScope,
        )

        assertEquals(480L * 1024, AttachmentRepository.RELAY_SAFE_ATTACHMENT_BYTES)
        coVerify(exactly = 1) {
            api.uploadAttachment(
                "todo-1", idempotencyKey, null, any(), ExpectedSessionScope(expectedScope),
            )
        }
        coVerify(exactly = 1) {
            api.uploadAttachment(
                "todo-1", idempotencyKey, "true", any(), ExpectedSessionScope(expectedScope),
            )
        }
    }

    @Test
    fun `direct-only transport failure is explicit and retryable by the outbox`() = runTest {
        coEvery {
            api.uploadAttachment(any(), any(), any(), any(), any())
        } throws DirectConnectionRequiredException(IOException("offline"))
        val file = File.createTempFile("clawchat-direct-only", ".pdf").apply {
            writeText("body")
            deleteOnExit()
        }

        val result = repository.uploadAttachment(
            "todo-1", file, "paper.pdf", "application/pdf",
            idempotencyKey, expectedScope,
        )

        assertEquals(ShareAttachmentUploadResult.DirectConnectionRequired, result)
    }

    private fun attachment() = Attachment(
        id = "attachment-1",
        filename = "notes.txt",
        storedFilename = "stored.txt",
        contentType = "text/plain",
        sizeBytes = 11,
        todoId = "todo-1",
        url = "/api/attachments/attachment-1/download",
        createdAt = "2026-08-31T00:00:00Z",
    )
}
