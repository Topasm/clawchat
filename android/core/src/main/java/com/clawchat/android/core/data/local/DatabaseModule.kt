package com.clawchat.android.core.data.local

import android.content.Context
import androidx.room.Room
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): ClawChatDatabase {
        return Room.databaseBuilder(
            context,
            ClawChatDatabase::class.java,
            ClawChatDatabase.DB_NAME,
        ).fallbackToDestructiveMigration().build()
    }

    @Provides
    fun provideTodoDao(db: ClawChatDatabase): TodoDao = db.todoDao()

    @Provides
    fun provideEventDao(db: ClawChatDatabase): EventDao = db.eventDao()
}
