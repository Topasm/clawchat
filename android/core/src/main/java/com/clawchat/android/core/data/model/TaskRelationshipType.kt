// Generated from server/openapi.json by scripts/generate-api-contracts.js. Do not edit.
package com.clawchat.android.core.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Canonical task relationship type shared with the ClawChat API. */
@Serializable
enum class TaskRelationshipType(val wireValue: String) {
    @SerialName("depends_on")
    DEPENDS_ON("depends_on"),

    @SerialName("related")
    RELATED("related"),

    @SerialName("duplicate")
    DUPLICATE("duplicate"),
    ;

    companion object {
        fun fromWireValue(value: String): TaskRelationshipType =
            entries.firstOrNull { it.wireValue == value }
                ?: throw IllegalArgumentException("Unsupported task relationship type: $value")
    }
}
