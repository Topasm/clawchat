package com.clawchat.android.core.di

import com.clawchat.android.core.api.ReviewApi
import com.clawchat.android.core.data.repository.ReviewRepository
import com.clawchat.android.core.data.repository.ReviewRepositoryImpl
import dagger.Binds
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
object ReviewNetworkModule {
    @Provides
    @Singleton
    fun provideReviewApi(
        @AuthenticatedClient client: OkHttpClient,
    ): ReviewApi {
        val json = Json {
            ignoreUnknownKeys = true
            coerceInputValues = true
            isLenient = true
        }
        return Retrofit.Builder()
            .baseUrl("http://localhost:8000/")
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ReviewApi::class.java)
    }
}

@Module
@InstallIn(SingletonComponent::class)
abstract class ReviewRepositoryModule {
    @Binds
    @Singleton
    abstract fun bindReviewRepository(impl: ReviewRepositoryImpl): ReviewRepository
}
