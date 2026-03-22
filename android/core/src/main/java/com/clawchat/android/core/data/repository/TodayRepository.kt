package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.model.TodayResponse
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.apiCall
import javax.inject.Inject
import javax.inject.Singleton

interface TodayRepository {
    suspend fun getToday(): ApiResult<TodayResponse>
}

@Singleton
class TodayRepositoryImpl @Inject constructor(
    private val api: ClawChatApi,
) : TodayRepository {

    override suspend fun getToday(): ApiResult<TodayResponse> =
        apiCall { api.getToday() }
}
