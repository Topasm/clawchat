package com.clawchat.android.core.data.local

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [
        TodoEntity::class,
        EventEntity::class,
        LocalTodoEntity::class,
        LocalEventEntity::class,
    ],
    version = 3,
    exportSchema = true,
)
abstract class ClawChatDatabase : RoomDatabase() {
    abstract fun todoDao(): TodoDao
    abstract fun eventDao(): EventDao
    abstract fun localTodoDao(): LocalTodoDao
    abstract fun localEventDao(): LocalEventDao

    companion object {
        const val DB_NAME = "clawchat_cache"
    }
}
