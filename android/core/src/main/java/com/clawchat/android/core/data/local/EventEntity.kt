package com.clawchat.android.core.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "events")
data class EventEntity(
    @PrimaryKey val id: String,
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
