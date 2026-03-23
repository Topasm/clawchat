package com.clawchat.android.core.data.local

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface TodoDao {
    @Query("SELECT * FROM todos ORDER BY sortOrder ASC, createdAt DESC")
    fun getAllFlow(): Flow<List<TodoEntity>>

    @Query("SELECT * FROM todos WHERE status != 'completed' AND status != 'cancelled' ORDER BY sortOrder ASC")
    fun getPendingFlow(): Flow<List<TodoEntity>>

    @Query("SELECT * FROM todos WHERE id = :id")
    suspend fun getById(id: String): TodoEntity?

    @Upsert
    suspend fun upsert(todo: TodoEntity)

    @Upsert
    suspend fun upsertAll(todos: List<TodoEntity>)

    @Query("DELETE FROM todos WHERE id = :id")
    suspend fun deleteById(id: String)

    @Query("DELETE FROM todos")
    suspend fun deleteAll()

    @Query("UPDATE todos SET status = :status, completedAt = :completedAt, updatedAt = :updatedAt WHERE id = :id")
    suspend fun updateStatus(id: String, status: String, completedAt: String?, updatedAt: String)
}
