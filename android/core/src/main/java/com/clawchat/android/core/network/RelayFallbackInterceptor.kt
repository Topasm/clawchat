package com.clawchat.android.core.network

import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

const val DIRECT_ONLY_HEADER = "X-ClawChat-Direct-Only"

class DirectConnectionRequiredException(cause: IOException) :
    IOException("A direct server connection is required for this request", cause)

@Singleton
class RelayFallbackInterceptor @Inject constructor(
    private val relayClient: RelayClient,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val incoming = chain.request()
        val directOnly = incoming.header(DIRECT_ONLY_HEADER) == "true"
        val request = incoming.newBuilder().removeHeader(DIRECT_ONLY_HEADER).build()
        return try {
            chain.proceed(request)
        } catch (directError: IOException) {
            if (directOnly) throw DirectConnectionRequiredException(directError)
            try {
                runBlocking { relayClient.execute(request) }
            } catch (relayError: Exception) {
                directError.addSuppressed(relayError)
                throw directError
            }
        }
    }
}
