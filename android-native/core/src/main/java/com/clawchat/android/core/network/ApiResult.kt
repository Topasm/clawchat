package com.clawchat.android.core.network

/**
 * Wrapper for API call results. Provides a consistent way to handle
 * success, error, and loading states in ViewModels.
 */
sealed interface ApiResult<out T> {
    data class Success<T>(val data: T) : ApiResult<T>
    data class Error(val message: String, val code: Int? = null) : ApiResult<Nothing>
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
    } catch (e: retrofit2.HttpException) {
        ApiResult.Error(e.message ?: "HTTP ${e.code()}", e.code())
    } catch (e: java.io.IOException) {
        ApiResult.Error("Network error: ${e.message}")
    } catch (e: Exception) {
        ApiResult.Error(e.message ?: "Unknown error")
    }
}
