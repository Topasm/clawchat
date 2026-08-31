package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.AttachmentApi
import com.clawchat.android.core.data.model.Attachment
import com.clawchat.android.core.data.model.ShareTodoCreate
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.DirectConnectionRequiredException
import com.clawchat.android.core.network.ExpectedSessionScope
import com.clawchat.android.core.network.apiCall
import kotlinx.coroutines.CancellationException
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AttachmentRepository @Inject constructor(
    private val api: AttachmentApi,
) {
    suspend fun createSharedTodo(
        body: ShareTodoCreate,
        expectedScope: String,
    ): ApiResult<Todo> = apiCall {
        api.createSharedTodo(body, ExpectedSessionScope(expectedScope))
    }

    /**
     * Upload a file that has already been copied into app-owned storage.
     * Callers retain ownership of [file] and must remove temporary files.
     */
    suspend fun uploadAttachment(
        todoId: String,
        file: File,
        displayName: String,
        mimeType: String,
        idempotencyKey: String,
        expectedScope: String,
    ): ShareAttachmentUploadResult {
        val requestBody = file.asRequestBody(mimeType.toMediaTypeOrNull())
        val part = MultipartBody.Part.createFormData("file", displayName, requestBody)
        val directOnly = if (file.length() > RELAY_SAFE_ATTACHMENT_BYTES) "true" else null
        return try {
            ShareAttachmentUploadResult.Success(
                api.uploadAttachment(
                    todoId,
                    idempotencyKey,
                    directOnly,
                    part,
                    ExpectedSessionScope(expectedScope),
                ),
            )
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: DirectConnectionRequiredException) {
            ShareAttachmentUploadResult.DirectConnectionRequired
        } catch (error: retrofit2.HttpException) {
            if (error.code() in RETRYABLE_HTTP_CODES || error.code() >= 500) {
                ShareAttachmentUploadResult.Retryable(error.message())
            } else {
                ShareAttachmentUploadResult.Permanent(error.message())
            }
        } catch (error: IOException) {
            ShareAttachmentUploadResult.Retryable(error.message)
        } catch (error: Exception) {
            ShareAttachmentUploadResult.Permanent(error.message)
        }
    }

    companion object {
        // Relay frames are capped at 1 MiB and base64 expands the multipart
        // body by 4/3. Keep enough room for JSON, encryption, and headers.
        // The file is base64-encoded into the HTTP relay payload, then the
        // encrypted payload is base64-encoded again for the WebSocket frame
        // (roughly 16/9 expansion). 480 KiB leaves headroom below the relay's
        // 1 MiB frame cap for multipart, JSON, encryption, and headers.
        const val RELAY_SAFE_ATTACHMENT_BYTES: Long = 480L * 1024
        private val RETRYABLE_HTTP_CODES = setOf(401, 408, 409, 425, 429)
    }
}

sealed interface ShareAttachmentUploadResult {
    data class Success(val attachment: Attachment) : ShareAttachmentUploadResult
    data object DirectConnectionRequired : ShareAttachmentUploadResult
    data class Retryable(val message: String?) : ShareAttachmentUploadResult
    data class Permanent(val message: String?) : ShareAttachmentUploadResult
}
