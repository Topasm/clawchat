package com.clawchat.android.core.api

import com.clawchat.android.core.data.model.HealthResponse
import com.clawchat.android.core.data.model.LoginRequest
import com.clawchat.android.core.data.model.LoginResponse
import com.clawchat.android.core.data.model.PairingClaimRequest
import com.clawchat.android.core.data.model.PairingClaimResponse
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Url

/**
 * Retrofit interface for unauthenticated endpoints used during
 * onboarding: health checks, pairing claim, and manual login.
 *
 * Uses @Url to accept a dynamic base URL (since the server URL
 * is not yet known at app startup).
 */
interface PairingApi {

    @GET
    suspend fun health(@Url url: String): HealthResponse

    @POST
    suspend fun claimPairing(
        @Url url: String,
        @Body body: PairingClaimRequest,
    ): PairingClaimResponse

    @POST
    suspend fun login(
        @Url url: String,
        @Body body: LoginRequest,
    ): LoginResponse
}
