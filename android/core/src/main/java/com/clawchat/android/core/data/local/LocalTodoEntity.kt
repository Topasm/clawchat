package com.clawchat.android.core.data.local

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * A task owned by this Android device.
 *
 * This deliberately lives outside the server-backed [TodoEntity] cache. A
 * user can switch between local and server workspaces without either side
 * overwriting or exposing the other side's rows.
 */
@Entity(
    tableName = "local_todos",
    indices = [
        Index(
            name = "index_local_todos_default_order",
            value = ["sortOrder", "createdAt", "id"],
            orders = [Index.Order.ASC, Index.Order.DESC, Index.Order.ASC],
        ),
        Index(
            name = "index_local_todos_status_order",
            value = ["status", "sortOrder", "createdAt", "id"],
            orders = [Index.Order.ASC, Index.Order.ASC, Index.Order.DESC, Index.Order.ASC],
        ),
        Index(
            name = "index_local_todos_due_date",
            value = ["dueDate", "status"],
        ),
    ],
)
data class LocalTodoEntity(
    @PrimaryKey val id: String,
    val title: String,
    val description: String? = null,
    val status: String = "pending",
    val priority: String = "medium",
    val dueDate: String? = null,
    val completedAt: String? = null,
    val tags: String? = null,
    val parentId: String? = null,
    val sortOrder: Int = 0,
    val source: String? = null,
    val inboxState: String = "none",
    val createdAt: String,
    val updatedAt: String,
)
