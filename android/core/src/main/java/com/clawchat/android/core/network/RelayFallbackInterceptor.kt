package com.clawchat.android.core.network

import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class RelayFallbackInterceptor @Inject constructor(
    private val relayClient: RelayClient,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response = try {
        chain.proceed(chain.request())
    } catch (directError: IOException) {
        try {
            runBlocking { relayClient.execute(chain.request()) }
        } catch (relayError: Exception) {
            directError.addSuppressed(relayError)
            throw directError
        }
    }
}
