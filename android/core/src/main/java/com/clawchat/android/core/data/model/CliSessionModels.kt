package com.clawchat.android.core.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class CliSession(
    val id: String,
    val provider: String,
    val title: String,
    val cwd: String = "",
    val status: String,
    val kind: String,
    @SerialName("waiting_for") val waitingFor: String? = null,
    @SerialName("can_send") val canSend: Boolean = false,
    @SerialName("can_stop") val canStop: Boolean = false,
    @SerialName("can_restart") val canRestart: Boolean = false,
    @SerialName("can_read") val canRead: Boolean = false,
    @SerialName("resume_command") val resumeCommand: String? = null,
) {
    val key: String get() = "$provider:$id"
}

@Serializable
data class CliProviderState(val provider: String, val connected: Boolean, val message: String? = null)

@Serializable
data class CliSessionList(val sessions: List<CliSession>, val providers: List<CliProviderState>)

@Serializable
data class CliSessionDetail(val session: CliSession, val output: String = "")

@Serializable
data class CliSessionAction(val action: String, val message: String? = null)

@Serializable
data class CliSessionActionResult(val accepted: Boolean)
