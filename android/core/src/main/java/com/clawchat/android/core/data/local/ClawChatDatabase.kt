package com.clawchat.android.core.data.local

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [TodoEntity::class, EventEntity::class],
    version = 1,
    exportSchema = false,
)
abstract class ClawChatDatabase : RoomDatabase() {
    abstract fun todoDao(): TodoDao
    abstract fun eventDao(): EventDao

    companion object {
        const val DB_NAME = "clawchat_cache"
    }
}
