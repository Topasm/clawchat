package com.clawchat.android.core.network

import com.clawchat.android.core.data.SessionStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.HttpUrl
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
 *
 * The active URL is resolved for every request. DataStore keeps the latest
 * preferences in memory, and resolving it here avoids pinning OkHttp to the
 * server that happened to be configured when the first request was made.
 */
@Singleton
class BaseUrlInterceptor @Inject constructor(
    private val sessionStore: SessionStore,
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest = chain.request()
        val session = runBlocking { sessionStore.activeSession.first() }
        val expectedScope = originalRequest.tag(ExpectedSessionScope::class.java)?.value
        val activeScope = when (session?.authMode) {
            "paired" -> session.hostId
            "manual" -> session.apiBaseUrl?.trimEnd('/')
            else -> session?.hostId ?: session?.apiBaseUrl?.trimEnd('/')
        }
        if (expectedScope != null && expectedScope != activeScope) {
            // Durable background writes are owned by the workspace that first
            // accepted them. Fail before routing or authentication if the user
            // switches workspaces while a worker is in flight.
            throw SessionScopeChangedException(expectedScope, activeScope)
        }
        val newBaseUrl = session?.apiBaseUrl?.trimEnd('/')?.toHttpUrlOrNull()

        if (session == null || newBaseUrl == null) {
            return chain.proceed(originalRequest)
        }

        val newUrl = originalRequest.url.newBuilder()
            .scheme(newBaseUrl.scheme)
            .host(newBaseUrl.host)
            .port(newBaseUrl.port)
            .build()

        val newRequest = originalRequest.newBuilder()
            .url(newUrl)
            // AuthInterceptor must use this exact token/host snapshot. Reading
            // both values independently can leak a newly selected workspace's
            // token to a request already routed to the previous workspace.
            .tag(AuthenticatedRoute::class.java, AuthenticatedRoute(newBaseUrl, session.token))
            .build()

        return chain.proceed(newRequest)
    }
}

internal data class AuthenticatedRoute(
    val baseUrl: HttpUrl,
    val token: String,
)
