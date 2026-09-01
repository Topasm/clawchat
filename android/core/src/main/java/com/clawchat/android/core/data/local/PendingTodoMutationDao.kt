package com.clawchat.android.core.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface PendingTodoMutationDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(mutation: PendingTodoMutationEntity)

    @Query(
        "SELECT * FROM pending_todo_mutations WHERE workspaceKey = :workspaceKey " +
            "ORDER BY changedAt ASC, operationId ASC",
    )
    suspend fun getForWorkspace(workspaceKey: String): List<PendingTodoMutationEntity>

    @Query(
        "SELECT * FROM pending_todo_mutations WHERE workspaceKey = :workspaceKey " +
            "AND todoId = :todoId ORDER BY changedAt ASC, operationId ASC",
    )
    suspend fun getForTodo(workspaceKey: String, todoId: String): List<PendingTodoMutationEntity>

    @Query(
        "DELETE FROM pending_todo_mutations WHERE workspaceKey = :workspaceKey " +
            "AND operationId IN (:operationIds)",
    )
    suspend fun deleteOperations(workspaceKey: String, operationIds: List<String>)

    @Query(
        "DELETE FROM pending_todo_mutations WHERE workspaceKey = :workspaceKey AND todoId = :todoId",
    )
    suspend fun deleteForTodo(workspaceKey: String, todoId: String)
}
