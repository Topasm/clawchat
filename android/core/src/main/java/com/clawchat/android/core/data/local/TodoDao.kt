package com.clawchat.android.core.data.local

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface TodoDao {
    @Query(
        "SELECT * FROM todos WHERE workspaceKey = :workspaceKey " +
            "ORDER BY sortOrder ASC, createdAt DESC, id ASC",
    )
    fun getAllFlow(workspaceKey: String): Flow<List<TodoEntity>>

    @Query(
        "SELECT * FROM todos WHERE workspaceKey = :workspaceKey " +
            "AND status != 'completed' AND status != 'cancelled' " +
            "ORDER BY sortOrder ASC, createdAt DESC, id ASC",
    )
    fun getPendingFlow(workspaceKey: String): Flow<List<TodoEntity>>

    /**
     * Cached tasks that are still open and are due before [toExclusive] — the
     * offline stand-in for the server's Today and Overdue buckets. Due values
     * are ISO date/date-time strings, so a next-day boundary includes every
     * value on the requested day without applying a function to the column.
     */
    @Query(
        "SELECT * FROM todos WHERE workspaceKey = :workspaceKey AND dueDate IS NOT NULL " +
            "AND dueDate < :toExclusive " +
            "AND status != 'completed' AND status != 'cancelled' " +
            "ORDER BY dueDate ASC, id ASC",
    )
    suspend fun getOpenDueBefore(workspaceKey: String, toExclusive: String): List<TodoEntity>

    @Query("SELECT * FROM todos WHERE workspaceKey = :workspaceKey AND id = :id")
    suspend fun getById(workspaceKey: String, id: String): TodoEntity?

    @Upsert
    suspend fun upsert(todo: TodoEntity)

    @Upsert
    suspend fun upsertAll(todos: List<TodoEntity>)

    @Query("DELETE FROM todos WHERE workspaceKey = :workspaceKey AND id = :id")
    suspend fun deleteById(workspaceKey: String, id: String)

    @Query("DELETE FROM todos WHERE workspaceKey = :workspaceKey")
    suspend fun deleteAll(workspaceKey: String)

    @Query(
        "UPDATE todos SET status = :status, completedAt = :completedAt, updatedAt = :updatedAt " +
            "WHERE workspaceKey = :workspaceKey AND id = :id",
    )
    suspend fun updateStatus(
        workspaceKey: String,
        id: String,
        status: String,
        completedAt: String?,
        updatedAt: String,
    )
}
