package com.clawchat.android.di

import com.clawchat.android.core.api.AttachmentApi
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

@Module
@InstallIn(SingletonComponent::class)
object ShareCaptureModule {
    private val json = Json {
        ignoreUnknownKeys = true
        // ShareTodoCreate's source/inbox defaults are part of the wire
        // contract, not merely Kotlin conveniences.
        encodeDefaults = true
    }

    @Provides
    @Singleton
    fun provideAttachmentApi(
        @AuthenticatedClient client: OkHttpClient,
    ): AttachmentApi = Retrofit.Builder()
        // BaseUrlInterceptor replaces the placeholder for every request.
        .baseUrl("http://localhost:8000/")
        .client(client)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()
        .create(AttachmentApi::class.java)
}
