package com.clawchat.android.di

import com.clawchat.android.core.api.AgentRunApi
import com.clawchat.android.core.di.AuthenticatedClient
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import javax.inject.Singleton

/** Keeps the runs API additive until it is folded into the shared network module. */
@Module
@InstallIn(SingletonComponent::class)
object AgentRunNetworkModule {
    private val json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
        isLenient = true
    }

    @Provides
    @Singleton
    fun provideAgentRunApi(
        @AuthenticatedClient client: OkHttpClient,
    ): AgentRunApi = Retrofit.Builder()
        // BaseUrlInterceptor replaces this placeholder with the active host.
        .baseUrl("http://localhost:8000/")
        .client(client)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()
        .create(AgentRunApi::class.java)
}
