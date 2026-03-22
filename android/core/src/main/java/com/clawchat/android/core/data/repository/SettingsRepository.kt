package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.model.HealthResponse
import com.clawchat.android.core.data.model.SettingsResponse
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.apiCall
import javax.inject.Inject
import javax.inject.Singleton

interface SettingsRepository {
    suspend fun getSettings(): ApiResult<SettingsResponse>
    suspend fun saveSettings(payload: Map<String, @JvmSuppressWildcards Any>): ApiResult<SettingsResponse>
    suspend fun health(): ApiResult<HealthResponse>
}

@Singleton
class SettingsRepositoryImpl @Inject constructor(
    private val api: ClawChatApi,
) : SettingsRepository {

    override suspend fun getSettings(): ApiResult<SettingsResponse> =
        apiCall { api.getSettings() }

    override suspend fun saveSettings(payload: Map<String, @JvmSuppressWildcards Any>): ApiResult<SettingsResponse> =
        apiCall { api.saveSettings(payload) }

    override suspend fun health(): ApiResult<HealthResponse> =
        apiCall { api.health() }
}
