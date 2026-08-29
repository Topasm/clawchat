package com.clawchat.android.core.data.local

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface EventDao {
    @Query("SELECT * FROM events ORDER BY startTime ASC")
    fun getAllFlow(): Flow<List<EventEntity>>

    @Upsert
    suspend fun upsertAll(events: List<EventEntity>)

    @Query("DELETE FROM events")
    suspend fun deleteAll()

    @Query("SELECT * FROM events WHERE substr(startTime, 1, 10) BETWEEN :from AND :to ORDER BY startTime ASC")
    suspend fun getBetween(from: String, to: String): List<EventEntity>

    @Query("DELETE FROM events WHERE substr(startTime, 1, 10) BETWEEN :from AND :to")
    suspend fun deleteBetween(from: String, to: String)

    /**
     * Replaces the cache for one date range. Upserting alone would leave an
     * event that has since been deleted or moved out of the range behind, and
     * clearing the whole table would throw away the ranges another screen
     * cached.
     */
    @Transaction
    suspend fun replaceRange(from: String, to: String, events: List<EventEntity>) {
        deleteBetween(from, to)
        upsertAll(events)
    }
}
