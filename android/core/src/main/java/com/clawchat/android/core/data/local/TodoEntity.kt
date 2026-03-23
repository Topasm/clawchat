package com.clawchat.android.core.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "todos")
data class TodoEntity(
    @PrimaryKey val id: String,
    val title: String,
    val description: String? = null,
    val status: String = "pending",
    val priority: String = "medium",
    val dueDate: String? = null,
    val completedAt: String? = null,
    val tags: String? = null,  // JSON array as string
    val parentId: String? = null,
    val sortOrder: Int = 0,
    val inboxState: String = "none",
    val isRecurring: Boolean = false,
    val recurrenceRule: String? = null,
    val createdAt: String,
    val updatedAt: String,
)
