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
        )
            .addMigrations(
                MIGRATION_1_2,
                MIGRATION_2_3,
                MIGRATION_3_4,
                MIGRATION_4_5,
                MIGRATION_5_6,
            )
            .build()
    }

    @Provides
    fun provideTodoDao(db: ClawChatDatabase): TodoDao = db.todoDao()

    @Provides
    fun provideEventDao(db: ClawChatDatabase): EventDao = db.eventDao()

    @Provides
    fun provideLocalTodoDao(db: ClawChatDatabase): LocalTodoDao = db.localTodoDao()

    @Provides
    fun provideLocalEventDao(db: ClawChatDatabase): LocalEventDao = db.localEventDao()

    @Provides
    fun providePendingTodoMutationDao(db: ClawChatDatabase): PendingTodoMutationDao =
        db.pendingTodoMutationDao()

    @Provides
    fun providePendingReviewDecisionDao(db: ClawChatDatabase): PendingReviewDecisionDao =
        db.pendingReviewDecisionDao()
}
