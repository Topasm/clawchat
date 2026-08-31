package com.clawchat.android.core.network

import android.util.Log
import com.clawchat.android.core.api.PairingApi
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.model.RefreshRequest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import javax.inject.Inject
import javax.inject.Singleton

/** Rotates a manual PIN session without ever retaining the PIN itself. */
@Singleton
class SessionRefresher @Inject constructor(
    private val sessionStore: SessionStore,
    private val pairingApi: PairingApi,
) {
    companion object {
        private const val TAG = "SessionRefresher"
    }

    private val refreshMutex = Mutex()

    suspend fun refreshAfterUnauthorized(rejectedAccessToken: String?): String? =
        refreshMutex.withLock {
            val session = sessionStore.activeSession.first()
            val currentAccessToken = session?.token
            if (
                !rejectedAccessToken.isNullOrBlank() &&
                !currentAccessToken.isNullOrBlank() &&
                currentAccessToken != rejectedAccessToken
            ) {
                return@withLock currentAccessToken
            }

            if (session?.authMode != "manual") return@withLock null
            val accessToken = session.token
            val refreshToken = session.refreshToken ?: return@withLock null
            val baseUrl = session.apiBaseUrl?.trimEnd('/') ?: return@withLock null

            try {
                val response = pairingApi.refresh(
                    url = "$baseUrl/api/auth/refresh",
                    body = RefreshRequest(refreshToken),
                )
                val rotated = sessionStore.rotateManualSession(
                    expectedAccessToken = accessToken,
                    expectedRefreshToken = refreshToken,
                    expectedApiBaseUrl = baseUrl,
                    accessToken = response.accessToken,
                    refreshToken = response.refreshToken,
                )
                if (rotated) {
                    response.accessToken
                } else {
                    sessionStore.activeSession.first()?.token?.takeUnless { it == accessToken }
                }
            } catch (error: Exception) {
                Log.w(TAG, "Could not restore the remembered session: ${error.message}")
                null
            }
        }
}
