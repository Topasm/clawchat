package com.clawchat.android.core.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** `POST /api/notifications/register-token`: the FCM token for this paired device. */
@Serializable
data class RegisterPushTokenRequest(
    val token: String,
)

@Serializable
data class RegisterPushTokenResponse(
    val status: String,
    @SerialName("device_id") val deviceId: String? = null,
    val reason: String? = null,
)
