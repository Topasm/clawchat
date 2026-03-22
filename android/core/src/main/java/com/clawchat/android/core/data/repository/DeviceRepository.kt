package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.model.DeviceListResponse
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.apiCall
import javax.inject.Inject
import javax.inject.Singleton

interface DeviceRepository {
    suspend fun listDevices(): ApiResult<DeviceListResponse>
    suspend fun revokeDevice(id: String): ApiResult<Unit>
}

@Singleton
class DeviceRepositoryImpl @Inject constructor(
    private val api: ClawChatApi,
) : DeviceRepository {

    override suspend fun listDevices(): ApiResult<DeviceListResponse> =
        apiCall { api.listDevices() }

    override suspend fun revokeDevice(id: String): ApiResult<Unit> =
        apiCall { api.revokeDevice(id) }
}
