// Generated from server/openapi.json by scripts/generate-api-contracts.js. Do not edit.
package com.clawchat.android.core.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Canonical task lifecycle shared with the ClawChat API. */
@Serializable
enum class TaskStatus(val wireValue: String) {
    @SerialName("pending")
    PENDING("pending"),

    @SerialName("in_progress")
    IN_PROGRESS("in_progress"),

    @SerialName("completed")
    COMPLETED("completed"),

    @SerialName("cancelled")
    CANCELLED("cancelled"),
    ;

    companion object {
        fun fromWireValue(value: String): TaskStatus =
            entries.firstOrNull { it.wireValue == value }
                ?: throw IllegalArgumentException("Unsupported task status: $value")
    }
}
