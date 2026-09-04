package com.clawchat.android.core.data.local

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import com.clawchat.android.core.data.model.EventUpdate
import kotlinx.coroutines.flow.Flow
import java.time.ZoneId

data class LocalEventSearchRow(
    val id: String,
    val title: String,
    val description: String?,
    val createdAt: String,
)

@Dao
interface LocalEventDao {
    @Query("SELECT * FROM local_events ORDER BY startEpochMillis ASC, id ASC")
    fun getAllFlow(): Flow<List<LocalEventEntity>>

    @Query("SELECT * FROM local_events WHERE id = :id")
    suspend fun getById(id: String): LocalEventEntity?

    @Query(
        "SELECT * FROM local_events " +
            "WHERE startEpochMillis >= :fromInclusive AND startEpochMillis < :toExclusive " +
            "ORDER BY startEpochMillis ASC, id ASC",
    )
    suspend fun getBetween(fromInclusive: Long, toExclusive: Long): List<LocalEventEntity>

    @Query(
        """
        SELECT id, title, description, createdAt FROM local_events
        WHERE title LIKE :pattern ESCAPE '\' COLLATE NOCASE
           OR description LIKE :pattern ESCAPE '\' COLLATE NOCASE
        ORDER BY createdAt DESC, id ASC
        LIMIT :limit
        """,
    )
    suspend fun search(pattern: String, limit: Int): List<LocalEventSearchRow>

    @Upsert
    suspend fun upsert(event: LocalEventEntity)

    /** Keeps concurrent calendar patches inside one Room transaction. */
    @Transaction
    suspend fun updateExisting(
        id: String,
        update: EventUpdate,
        now: String,
        zoneId: ZoneId,
    ): LocalEventEntity? {
        val current = getById(id) ?: return null
        return current.applyUpdate(update, now, zoneId).also { upsert(it) }
    }

    @Query("DELETE FROM local_events WHERE id = :id")
    suspend fun deleteById(id: String)
}
