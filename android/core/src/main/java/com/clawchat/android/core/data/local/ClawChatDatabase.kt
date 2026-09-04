package com.clawchat.android.core.data.local

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [
        TodoEntity::class,
        EventEntity::class,
        LocalTodoEntity::class,
        LocalEventEntity::class,
        PendingTodoMutationEntity::class,
        PendingReviewDecisionEntity::class,
    ],
    version = 7,
    exportSchema = true,
)
abstract class ClawChatDatabase : RoomDatabase() {
    abstract fun todoDao(): TodoDao
    abstract fun eventDao(): EventDao
    abstract fun localTodoDao(): LocalTodoDao
    abstract fun localEventDao(): LocalEventDao
    abstract fun pendingTodoMutationDao(): PendingTodoMutationDao
    abstract fun pendingReviewDecisionDao(): PendingReviewDecisionDao

    companion object {
        const val DB_NAME = "clawchat_cache"
    }
}
