package com.clawchat.android.widget.di

import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.repository.TodayRepository
import com.clawchat.android.core.data.repository.TodoRepository
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

@EntryPoint
@InstallIn(SingletonComponent::class)
interface WidgetEntryPoint {
    fun todayRepository(): TodayRepository
    fun todoRepository(): TodoRepository
    fun sessionStore(): SessionStore
}
