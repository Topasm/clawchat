package com.clawchat.android.core.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * A folder another machine shares through the workspace, read-only.
 *
 * The files stay on that machine; the server relays each request to it and
 * keeps only names and dates for when it is off.
 */
@Serializable
data class DataSource(
    val id: String,
    @SerialName("host_id") val hostId: String = "",
    @SerialName("host_label") val hostLabel: String = "",
    val kind: String = "obsidian_vault",
    val name: String,
    val capabilities: List<String> = emptyList(),
    @SerialName("is_online") val isOnline: Boolean = false,
    @SerialName("last_seen_at") val lastSeenAt: String? = null,
    @SerialName("indexed_files") val indexedFiles: Int = 0,
)

@Serializable
data class DataSourceQueryRequest(
    val op: String,
    val path: String? = null,
    val query: String? = null,
)

@Serializable
data class DataSourceEntry(
    val path: String,
    val name: String,
    val title: String = name,
    @SerialName("is_dir") val isDir: Boolean = false,
    val size: Long? = null,
    @SerialName("modified_at") val modifiedAt: String? = null,
)

@Serializable
data class DataSourceSearchMatch(
    val path: String,
    val title: String,
    val snippet: String? = null,
    val line: Int? = null,
)

@Serializable
data class DataSourceTodoItem(
    val title: String,
    val status: String,
    @SerialName("due_date") val dueDate: String? = null,
)

@Serializable
data class DataSourceQueryResult(
    val op: String,
    val path: String = "",
    /** `live` came from the machine now; `cache` is the names Home kept. */
    val origin: String = "live",
    /** `offline` or `timeout` when the cache answered. */
    @SerialName("fallback_reason") val fallbackReason: String? = null,
    @SerialName("is_online") val isOnline: Boolean = true,
    @SerialName("last_seen_at") val lastSeenAt: String? = null,
    val entries: List<DataSourceEntry> = emptyList(),
    val matches: List<DataSourceSearchMatch> = emptyList(),
    val content: String? = null,
    val tasks: List<DataSourceTodoItem>? = null,
    val truncated: Boolean = false,
)
