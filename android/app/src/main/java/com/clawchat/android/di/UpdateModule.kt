package com.clawchat.android.di

import com.clawchat.android.BuildConfig
import com.clawchat.android.core.di.UnauthenticatedClient
import com.clawchat.android.core.di.UpdateClient
import com.clawchat.android.core.update.ApkInstaller
import com.clawchat.android.core.update.ApkInstallerImpl
import com.clawchat.android.core.update.AppUpdateRepository
import com.clawchat.android.core.update.AppUpdateRepositoryImpl
import com.clawchat.android.core.update.GithubReleaseApi
import com.clawchat.android.core.update.UpdateConfig
import com.clawchat.android.core.update.UpdateDownloader
import com.clawchat.android.core.update.UpdateDownloaderImpl
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
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object UpdateModule {

    private const val GITHUB_API_BASE_URL = "https://api.github.com/"

    private val json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
        isLenient = true
    }

    @Provides
    @Singleton
    fun provideUpdateConfig(): UpdateConfig = UpdateConfig(
        repository = BuildConfig.UPDATE_REPOSITORY,
        currentVersion = BuildConfig.VERSION_NAME,
        enabled = BuildConfig.UPDATE_ENABLED,
    )

    // An APK download runs far longer than an API call, and it follows a
    // redirect from api.github.com to the release object storage.
    @Provides
    @Singleton
    @UpdateClient
    fun provideUpdateClient(
        @UnauthenticatedClient client: OkHttpClient,
    ): OkHttpClient = client.newBuilder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .callTimeout(0, TimeUnit.MILLISECONDS)
        .followRedirects(true)
        .build()

    @Provides
    @Singleton
    fun provideGithubReleaseApi(
        @UpdateClient client: OkHttpClient,
    ): GithubReleaseApi = Retrofit.Builder()
        .baseUrl(GITHUB_API_BASE_URL)
        .client(client)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()
        .create(GithubReleaseApi::class.java)
}

@Module
@InstallIn(SingletonComponent::class)
abstract class UpdateBindingModule {

    @Binds
    @Singleton
    abstract fun bindAppUpdateRepository(impl: AppUpdateRepositoryImpl): AppUpdateRepository

    @Binds
    @Singleton
    abstract fun bindUpdateDownloader(impl: UpdateDownloaderImpl): UpdateDownloader

    @Binds
    @Singleton
    abstract fun bindApkInstaller(impl: ApkInstallerImpl): ApkInstaller
}
