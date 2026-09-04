package com.clawchat.android.core.data.local

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface EventDao {
    @Query(
        "SELECT * FROM events WHERE workspaceKey = :workspaceKey " +
            "ORDER BY startTime ASC, id ASC",
    )
    fun getAllFlow(workspaceKey: String): Flow<List<EventEntity>>

    @Upsert
    suspend fun upsertAll(events: List<EventEntity>)

    @Query("DELETE FROM events WHERE workspaceKey = :workspaceKey")
    suspend fun deleteAll(workspaceKey: String)

    @Query("DELETE FROM events WHERE workspaceKey = :workspaceKey AND id = :id")
    suspend fun deleteById(workspaceKey: String, id: String)

    @Query(
        "SELECT * FROM events WHERE workspaceKey = :workspaceKey " +
            "AND startTime >= :fromInclusive AND startTime < :toExclusive " +
            "ORDER BY startTime ASC, id ASC",
    )
    suspend fun getBetween(
        workspaceKey: String,
        fromInclusive: String,
        toExclusive: String,
    ): List<EventEntity>

    @Query(
        "DELETE FROM events WHERE workspaceKey = :workspaceKey " +
            "AND startTime >= :fromInclusive AND startTime < :toExclusive",
    )
    suspend fun deleteBetween(
        workspaceKey: String,
        fromInclusive: String,
        toExclusive: String,
    )

    /**
     * Replaces the cache for one date range. Upserting alone would leave an
     * event that has since been deleted or moved out of the range behind, and
     * clearing the whole table would throw away the ranges another screen
     * cached.
     */
    @Transaction
    suspend fun replaceRange(
        workspaceKey: String,
        fromInclusive: String,
        toExclusive: String,
        events: List<EventEntity>,
    ) {
        require(events.all { it.workspaceKey == workspaceKey }) {
            "Cannot write events into a different workspace cache"
        }
        deleteBetween(workspaceKey, fromInclusive, toExclusive)
        upsertAll(events)
    }
}
