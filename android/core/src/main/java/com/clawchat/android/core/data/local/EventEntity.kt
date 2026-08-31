package com.clawchat.android.core.data.local

import androidx.room.Entity
import androidx.room.Index

/** A server-owned event cached under the stable workspace that returned it. */
@Entity(
    tableName = "events",
    primaryKeys = ["workspaceKey", "id"],
    indices = [
        Index(
            name = "index_events_workspace_start_time",
            value = ["workspaceKey", "startTime", "id"],
        ),
    ],
)
data class EventEntity(
    val workspaceKey: String,
    val id: String,
    val title: String,
    val description: String? = null,
    val startTime: String,
    val endTime: String? = null,
    val location: String? = null,
    val isAllDay: Boolean = false,
    val reminderMinutes: Int? = null,
    val createdAt: String,
    val updatedAt: String,
)
