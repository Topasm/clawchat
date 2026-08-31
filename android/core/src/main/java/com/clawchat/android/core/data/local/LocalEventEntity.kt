package com.clawchat.android.core.data.local

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/** Calendar data owned by this device rather than cached from a server. */
@Entity(
    tableName = "local_events",
    indices = [
        Index(
            name = "index_local_events_start_epoch",
            value = ["startEpochMillis", "id"],
        ),
    ],
)
data class LocalEventEntity(
    @PrimaryKey val id: String,
    val title: String,
    val description: String? = null,
    val startTime: String,
    /** Canonical instant used for indexed, timezone-correct range queries. */
    val startEpochMillis: Long,
    val endTime: String? = null,
    val location: String? = null,
    val isAllDay: Boolean = false,
    val reminderMinutes: Int? = null,
    val createdAt: String,
    val updatedAt: String,
)
