package com.clawchat.android.core.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface PendingReviewDecisionDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(decision: PendingReviewDecisionEntity)

    @Query(
        "SELECT * FROM pending_review_decisions WHERE workspaceKey = :workspaceKey " +
            "ORDER BY changedAt ASC, reviewId ASC",
    )
    suspend fun getForWorkspace(workspaceKey: String): List<PendingReviewDecisionEntity>

    @Query(
        "SELECT * FROM pending_review_decisions WHERE workspaceKey = :workspaceKey " +
            "ORDER BY changedAt ASC, reviewId ASC",
    )
    fun observeForWorkspace(workspaceKey: String): Flow<List<PendingReviewDecisionEntity>>

    @Query(
        "DELETE FROM pending_review_decisions WHERE workspaceKey = :workspaceKey " +
            "AND reviewId = :reviewId",
    )
    suspend fun delete(workspaceKey: String, reviewId: String)

    @Query(
        "UPDATE pending_review_decisions SET attemptCount = attemptCount + 1, " +
            "lastAttemptAt = :attemptedAt, lastError = :error, nextRetryAt = :nextRetryAt " +
            "WHERE workspaceKey = :workspaceKey AND reviewId = :reviewId",
    )
    suspend fun recordFailure(
        workspaceKey: String,
        reviewId: String,
        attemptedAt: String,
        error: String,
        nextRetryAt: String,
    )

}
