package com.clawchat.android.core.network

import com.clawchat.android.core.data.SessionStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.Request
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

/**
 * OkHttp interceptor that attaches the device token (or access token)
 * from [SessionStore] to every outgoing request as a Bearer token.
 *
 * A 401 from a remembered manual session rotates its single-use refresh token
 * once, then retries the original request with the new access token.
 */
@Singleton
class AuthInterceptor @Inject constructor(
    private val sessionStore: SessionStore,
    private val sessionRefresher: SessionRefresher,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val route = chain.request().tag(AuthenticatedRoute::class.java)
        val token = route?.token
        val request = if (!token.isNullOrBlank()) {
            chain.request().newBuilder()
                .header("Authorization", "Bearer $token")
                .build()
        } else {
            chain.request()
        }
        val response = chain.proceed(request)
        if (response.code != 401 || token.isNullOrBlank()) return response

        val refreshedToken = runBlocking {
            sessionRefresher.refreshAfterUnauthorized(token)
        } ?: run {
            // The active workspace may have changed while refresh was in
            // flight. Only invalidate the exact token that received the 401.
            runBlocking { sessionStore.clearSessionIfToken(token) }
            return response
        }

        val refreshedSession = runBlocking { sessionStore.activeSession.first() }
        val refreshedBaseUrl = refreshedSession
            ?.apiBaseUrl
            ?.trimEnd('/')
            ?.toHttpUrlOrNull()
        if (
            refreshedSession?.token != refreshedToken ||
            refreshedBaseUrl == null ||
            !route.baseUrl.hasSameOrigin(refreshedBaseUrl)
        ) {
            // The user selected another workspace while this request was in
            // flight. Never replay a possibly mutating request on that host.
            return response
        }

        response.close()
        return chain.proceed(request.reroute(refreshedBaseUrl, refreshedToken))
    }
}

private fun okhttp3.HttpUrl.hasSameOrigin(other: okhttp3.HttpUrl): Boolean =
    scheme == other.scheme && host == other.host && port == other.port

private fun Request.reroute(
    baseUrl: okhttp3.HttpUrl,
    token: String,
): Request {
    val reroutedUrl = url.newBuilder()
        .scheme(baseUrl.scheme)
        .host(baseUrl.host)
        .port(baseUrl.port)
        .build()
    return newBuilder()
        .url(reroutedUrl)
        .header("Authorization", "Bearer $token")
        .tag(AuthenticatedRoute::class.java, AuthenticatedRoute(baseUrl, token))
        .build()
}
