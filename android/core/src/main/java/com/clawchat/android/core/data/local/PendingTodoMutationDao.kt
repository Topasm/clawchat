package com.clawchat.android.core.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

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
            "ORDER BY changedAt ASC, operationId ASC",
    )
    fun observeForWorkspace(workspaceKey: String): Flow<List<PendingTodoMutationEntity>>

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

    @Query(
        "UPDATE pending_todo_mutations SET attemptCount = 0, lastAttemptAt = NULL, " +
            "lastError = NULL, nextRetryAt = NULL WHERE workspaceKey = :workspaceKey " +
            "AND todoId = :todoId",
    )
    suspend fun clearDiagnostics(workspaceKey: String, todoId: String)

    @Query(
        "UPDATE pending_todo_mutations SET attemptCount = attemptCount + 1, " +
            "lastAttemptAt = :attemptedAt, lastError = :error, nextRetryAt = :nextRetryAt " +
            "WHERE workspaceKey = :workspaceKey AND todoId = :todoId",
    )
    suspend fun recordFailure(
        workspaceKey: String,
        todoId: String,
        attemptedAt: String,
        error: String,
        nextRetryAt: String,
    )

}
