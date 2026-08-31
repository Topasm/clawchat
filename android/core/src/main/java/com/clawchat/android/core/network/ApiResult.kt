package com.clawchat.android.core.network

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Wrapper for API call results. Provides a consistent way to handle
 * success, error, and loading states in ViewModels.
 */
sealed interface ApiResult<out T> {
    data class Success<T>(val data: T) : ApiResult<T>
    data class Error(
        val message: String,
        val code: Int? = null,
        val serverCode: String? = null,
    ) : ApiResult<Nothing>
    data object Loading : ApiResult<Nothing>
}

/** Map the success value while preserving error/loading states. */
inline fun <T, R> ApiResult<T>.map(transform: (T) -> R): ApiResult<R> = when (this) {
    is ApiResult.Success -> ApiResult.Success(transform(data))
    is ApiResult.Error -> this
    is ApiResult.Loading -> this
}

/** Execute an API call and wrap the result. */
suspend fun <T> apiCall(block: suspend () -> T): ApiResult<T> {
    return try {
        ApiResult.Success(block())
    } catch (cancelled: kotlinx.coroutines.CancellationException) {
        // Cancellation is control flow. Turning it into a network error lets
        // stale Activity/Worker work continue and can commit unintended state.
        throw cancelled
    } catch (e: retrofit2.HttpException) {
        val serverError = runCatching {
            parseServerError(e.response()?.errorBody()?.string())
        }.getOrNull()
        ApiResult.Error(
            message = serverError?.message ?: e.message ?: "HTTP ${e.code()}",
            code = e.code(),
            serverCode = serverError?.code,
        )
    } catch (e: java.io.IOException) {
        ApiResult.Error("Network error: ${e.message}")
    } catch (e: Exception) {
        ApiResult.Error(e.message ?: "Unknown error")
    }
}

private data class ServerError(val code: String?, val message: String)

private fun parseServerError(rawBody: String?): ServerError? = runCatching {
    val error = Json.parseToJsonElement(rawBody?.take(MAX_ERROR_BODY_LENGTH) ?: return null)
        .jsonObject["error"]
        ?.jsonObject
        ?: return null
    val message = error["message"]
        ?.jsonPrimitive
        ?.contentOrNull
        ?.trim()
        ?.takeIf(String::isNotEmpty)
        ?.take(MAX_ERROR_MESSAGE_LENGTH)
        ?: return null
    ServerError(
        code = error["code"]?.jsonPrimitive?.contentOrNull?.take(MAX_ERROR_CODE_LENGTH),
        message = message,
    )
}.getOrNull()

private const val MAX_ERROR_BODY_LENGTH = 64 * 1024
private const val MAX_ERROR_MESSAGE_LENGTH = 1_000
private const val MAX_ERROR_CODE_LENGTH = 120
