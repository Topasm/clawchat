package com.clawchat.android.di

import com.clawchat.android.core.network.ChatStreamer
import com.clawchat.android.core.network.ChatStreamerImpl
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class StreamingModule {

    @Binds
    @Singleton
    abstract fun bindChatStreamer(impl: ChatStreamerImpl): ChatStreamer
}
