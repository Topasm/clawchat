package com.clawchat.android.core.update

/**
 * Build-time updater wiring. The app module fills this in from `BuildConfig`
 * so the core module never has to know the applicationId or the repository.
 */
data class UpdateConfig(
    /** `owner/name` of the GitHub repository that publishes the releases. */
    val repository: String,
    /** `versionName` of the running build. */
    val currentVersion: String,
    /** False for builds that cannot install a published APK over themselves (debug keys). */
    val enabled: Boolean,
) {
    val owner: String get() = repository.substringBefore('/')
    val name: String get() = repository.substringAfter('/')

    val isValid: Boolean
        get() = enabled &&
            owner.isNotBlank() &&
            name.isNotBlank() &&
            repository.count { it == '/' } == 1 &&
            AppVersion.parse(currentVersion) != null
}
