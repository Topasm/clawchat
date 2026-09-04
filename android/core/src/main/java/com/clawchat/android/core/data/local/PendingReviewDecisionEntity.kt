package com.clawchat.android.core.data.local

import androidx.room.Entity
import androidx.room.Index

/** One confirmed review decision waiting for a safe, idempotent server replay. */
@Entity(
    tableName = "pending_review_decisions",
    primaryKeys = ["workspaceKey", "reviewId"],
    indices = [
        Index(
            name = "index_pending_review_workspace_time",
            value = ["workspaceKey", "changedAt"],
        ),
    ],
)
data class PendingReviewDecisionEntity(
    val workspaceKey: String,
    val reviewId: String,
    val subjectId: String,
    val decision: String,
    val note: String?,
    val changedAt: String,
    val attemptCount: Int = 0,
    val lastAttemptAt: String? = null,
    val lastError: String? = null,
    val nextRetryAt: String? = null,
)
