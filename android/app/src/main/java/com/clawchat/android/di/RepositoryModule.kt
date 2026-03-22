package com.clawchat.android.di

import com.clawchat.android.core.data.repository.ConversationRepository
import com.clawchat.android.core.data.repository.ConversationRepositoryImpl
import com.clawchat.android.core.data.repository.DeviceRepository
import com.clawchat.android.core.data.repository.DeviceRepositoryImpl
import com.clawchat.android.core.data.repository.SettingsRepository
import com.clawchat.android.core.data.repository.SettingsRepositoryImpl
import com.clawchat.android.core.data.repository.TodayRepository
import com.clawchat.android.core.data.repository.TodayRepositoryImpl
import com.clawchat.android.core.data.repository.TodoRepository
import com.clawchat.android.core.data.repository.TodoRepositoryImpl
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class RepositoryModule {

    @Binds
    @Singleton
    abstract fun bindTodoRepository(impl: TodoRepositoryImpl): TodoRepository

    @Binds
    @Singleton
    abstract fun bindTodayRepository(impl: TodayRepositoryImpl): TodayRepository

    @Binds
    @Singleton
    abstract fun bindConversationRepository(impl: ConversationRepositoryImpl): ConversationRepository

    @Binds
    @Singleton
    abstract fun bindSettingsRepository(impl: SettingsRepositoryImpl): SettingsRepository

    @Binds
    @Singleton
    abstract fun bindDeviceRepository(impl: DeviceRepositoryImpl): DeviceRepository
}
