package com.clawchat.android.core.data.local

import androidx.room.Entity
import androidx.room.Index

/** Durable server-mode edit waiting for connectivity to return. */
@Entity(
    tableName = "pending_todo_mutations",
    primaryKeys = ["workspaceKey", "operationId"],
    indices = [
        Index(
            name = "index_pending_todo_workspace_item_time",
            value = ["workspaceKey", "todoId", "changedAt"],
        ),
    ],
)
data class PendingTodoMutationEntity(
    val workspaceKey: String,
    val operationId: String,
    val todoId: String,
    val payload: String,
    val changedAt: String,
)
