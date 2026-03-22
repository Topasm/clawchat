package com.clawchat.android.core.network

import com.clawchat.android.core.data.SessionStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

/**
 * OkHttp interceptor that rewrites the base URL of every request
 * using the server URL stored in [SessionStore]. This allows the
 * Retrofit instance to be created once with a placeholder URL,
 * then dynamically route to the actual server after pairing.
 */
@Singleton
class BaseUrlInterceptor @Inject constructor(
    private val sessionStore: SessionStore,
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest = chain.request()
        val baseUrl = runBlocking { sessionStore.apiBaseUrl.first() }

        if (baseUrl.isNullOrBlank()) {
            return chain.proceed(originalRequest)
        }

        val newBaseUrl = baseUrl.trimEnd('/').toHttpUrlOrNull() ?: return chain.proceed(originalRequest)

        val newUrl = originalRequest.url.newBuilder()
            .scheme(newBaseUrl.scheme)
            .host(newBaseUrl.host)
            .port(newBaseUrl.port)
            .build()

        val newRequest = originalRequest.newBuilder()
            .url(newUrl)
            .build()

        return chain.proceed(newRequest)
    }
}
