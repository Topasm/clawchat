package com.clawchat.android.core.data.local

import androidx.room.Entity
import androidx.room.Index

/** A server-owned task cached under the stable workspace that returned it. */
@Entity(
    tableName = "todos",
    primaryKeys = ["workspaceKey", "id"],
    indices = [
        Index(
            name = "index_todos_workspace_order",
            value = ["workspaceKey", "sortOrder", "createdAt", "id"],
            orders = [Index.Order.ASC, Index.Order.ASC, Index.Order.DESC, Index.Order.ASC],
        ),
        Index(
            name = "index_todos_workspace_due_date",
            value = ["workspaceKey", "dueDate", "status"],
        ),
    ],
)
data class TodoEntity(
    val workspaceKey: String,
    val id: String,
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
