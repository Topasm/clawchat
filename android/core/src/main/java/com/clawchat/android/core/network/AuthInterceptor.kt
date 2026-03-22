package com.clawchat.android.core.network

import com.clawchat.android.core.data.SessionStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

/**
 * OkHttp interceptor that attaches the device token (or access token)
 * from [SessionStore] to every outgoing request as a Bearer token.
 *
 * Caches the token in-memory so that only the first request (or after
 * a session change) hits DataStore; subsequent requests read from the
 * volatile field without blocking.
 */
@Singleton
class AuthInterceptor @Inject constructor(
    private val sessionStore: SessionStore,
) : Interceptor {

    @Volatile
    private var cachedToken: String? = null

    override fun intercept(chain: Interceptor.Chain): Response {
        val token = cachedToken ?: runBlocking { sessionStore.token.first() }.also { cachedToken = it }
        val request = if (!token.isNullOrBlank()) {
            chain.request().newBuilder()
                .addHeader("Authorization", "Bearer $token")
                .build()
        } else {
            chain.request()
        }
        return chain.proceed(request)
    }

    /** Called by SessionStore after login/logout to invalidate the cache. */
    fun invalidateToken() {
        cachedToken = null
    }
}
