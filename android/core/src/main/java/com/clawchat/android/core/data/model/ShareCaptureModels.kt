package com.clawchat.android.core.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Minimal task body used by the durable Android share outbox. */
@Serializable
data class ShareTodoCreate(
    val title: String,
    val description: String? = null,
    val source: String = "share_sheet",
    @SerialName("inbox_state") val inboxState: String = "classifying",
    @SerialName("idempotency_key") val idempotencyKey: String,
)
