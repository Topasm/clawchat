package com.clawchat.android.core.di

import javax.inject.Qualifier

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class AuthenticatedClient

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class UnauthenticatedClient

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class DebugServerUrl

/** OkHttp client for GitHub release metadata and APK downloads. */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class UpdateClient
