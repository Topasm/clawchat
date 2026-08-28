package com.clawchat.android.core.update

import com.clawchat.android.core.network.ApiResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/** Where the updater is in the check → download → install sequence. */
enum class UpdatePhase { Idle, Checking, UpToDate, Available, Downloading, ReadyToInstall, Failed }

data class UpdateState(
    val currentVersion: String = "",
    val supported: Boolean = false,
    val phase: UpdatePhase = UpdatePhase.Idle,
    val update: AvailableUpdate? = null,
    val downloadedBytes: Long = 0,
    val totalBytes: Long = 0,
    val downloadedFile: File? = null,
    val error: String? = null,
    val autoCheckEnabled: Boolean = true,
    /** True while the launch-time prompt for [update] should be on screen. */
    val promptVisible: Boolean = false,
    /** True when the system still has to grant "install unknown apps". */
    val needsInstallPermission: Boolean = false,
) {
    /** 0f..1f, or null while the download size is unknown. */
    val progress: Float?
        get() = if (phase == UpdatePhase.Downloading && totalBytes > 0) {
            (downloadedBytes.toFloat() / totalBytes.toFloat()).coerceIn(0f, 1f)
        } else {
            null
        }
}

/**
 * Owns the in-app update lifecycle against GitHub Releases.
 *
 * A singleton rather than a ViewModel because a download has to survive
 * navigation between the launch prompt and the Settings screen, and because
 * both hosts drive the same sequence.
 */
@Singleton
class AppUpdateManager internal constructor(
    private val repository: AppUpdateRepository,
    private val downloader: UpdateDownloader,
    private val installer: ApkInstaller,
    private val preferences: UpdatePreferences,
    private val config: UpdateConfig,
    private val scope: CoroutineScope,
    private val clock: () -> Long,
) {

    @Inject
    constructor(
        repository: AppUpdateRepository,
        downloader: UpdateDownloader,
        installer: ApkInstaller,
        preferences: UpdatePreferences,
        config: UpdateConfig,
    ) : this(
        repository = repository,
        downloader = downloader,
        installer = installer,
        preferences = preferences,
        config = config,
        scope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
        clock = { System.currentTimeMillis() },
    )

    private val _state = MutableStateFlow(
        UpdateState(currentVersion = config.currentVersion, supported = config.isValid),
    )
    val state: StateFlow<UpdateState> = _state.asStateFlow()

    private var checkJob: Job? = null
    private var downloadJob: Job? = null

    /** Refreshes the stored preferences into the observable state. */
    fun refreshPreferences() {
        scope.launch {
            val enabled = preferences.isAutoCheckEnabled()
            _state.update { it.copy(autoCheckEnabled = enabled) }
        }
    }

    /**
     * Launch-time check. It stays silent unless a newer, non-skipped release
     * exists, and it only reaches the network once per [CHECK_INTERVAL_MILLIS].
     */
    fun checkForUpdateIfDue() {
        if (!config.isValid) return
        scope.launch {
            val enabled = preferences.isAutoCheckEnabled()
            _state.update { it.copy(autoCheckEnabled = enabled) }
            if (!enabled) return@launch
            // 0 means "never checked", which is always due.
            val lastCheckedAt = preferences.lastCheckedAtMillis()
            if (lastCheckedAt > 0 && clock() - lastCheckedAt < CHECK_INTERVAL_MILLIS) return@launch
            runCheck(manual = false)
        }
    }

    /** Explicit "check now" from Settings. It always reaches the network. */
    fun checkForUpdate() {
        if (!config.isValid) {
            _state.update {
                it.copy(phase = UpdatePhase.Failed, error = UNSUPPORTED_MESSAGE)
            }
            return
        }
        if (checkJob?.isActive == true) return
        checkJob = scope.launch { runCheck(manual = true) }
    }

    private suspend fun runCheck(manual: Boolean) {
        if (_state.value.phase == UpdatePhase.Downloading) return
        // A silent launch-time check must leave the visible state untouched
        // when the network is unreachable, which is the common case offline.
        val previousPhase = _state.value.phase
        _state.update { it.copy(phase = UpdatePhase.Checking, error = null) }
        val result = repository.findUpdate()
        preferences.recordCheckedAt(clock())
        when (result) {
            is ApiResult.Success -> {
                val update = result.data
                if (update == null) {
                    _state.update {
                        it.copy(
                            phase = UpdatePhase.UpToDate,
                            update = null,
                            promptVisible = false,
                            error = null,
                        )
                    }
                    return
                }
                val skipped = preferences.skippedVersion()
                _state.update {
                    it.copy(
                        phase = UpdatePhase.Available,
                        update = update,
                        downloadedFile = null,
                        downloadedBytes = 0,
                        totalBytes = 0,
                        error = null,
                        promptVisible = manual || update.version != skipped,
                    )
                }
            }

            is ApiResult.Error -> _state.update {
                it.copy(
                    phase = if (manual) UpdatePhase.Failed else previousPhase,
                    error = if (manual) result.message else null,
                )
            }

            is ApiResult.Loading -> _state.update { it.copy(phase = previousPhase) }
        }
    }

    /** Downloads the pending release APK, reporting progress into [state]. */
    fun downloadUpdate() {
        val update = _state.value.update ?: return
        if (downloadJob?.isActive == true) return
        downloadJob = scope.launch {
            _state.update {
                it.copy(
                    phase = UpdatePhase.Downloading,
                    downloadedBytes = 0,
                    totalBytes = update.sizeBytes,
                    downloadedFile = null,
                    error = null,
                )
            }
            try {
                val file = downloader.download(update) { downloaded, total ->
                    _state.update { it.copy(downloadedBytes = downloaded, totalBytes = total) }
                }
                _state.update {
                    it.copy(
                        phase = UpdatePhase.ReadyToInstall,
                        downloadedFile = file,
                        needsInstallPermission = !installer.canInstallPackages(),
                    )
                }
            } catch (error: Exception) {
                _state.update {
                    it.copy(
                        phase = UpdatePhase.Failed,
                        downloadedFile = null,
                        error = error.message ?: "Update download failed",
                    )
                }
            }
        }
    }

    fun cancelDownload() {
        downloadJob?.cancel()
        downloadJob = null
        _state.update {
            it.copy(
                phase = if (it.update != null) UpdatePhase.Available else UpdatePhase.Idle,
                downloadedBytes = 0,
                totalBytes = 0,
                downloadedFile = null,
            )
        }
    }

    /**
     * Opens the system installer, or the permission screen first when the app
     * may not install packages yet.
     */
    fun installUpdate() {
        val file = _state.value.downloadedFile ?: return
        if (!installer.canInstallPackages()) {
            _state.update { it.copy(needsInstallPermission = true) }
            installer.requestInstallPermission()
            return
        }
        _state.update { it.copy(needsInstallPermission = false) }
        installer.install(file)
    }

    /** Hides the launch-time prompt without forgetting the pending update. */
    fun dismissPrompt() {
        _state.update { it.copy(promptVisible = false) }
    }

    /** Stops prompting for the pending version until a newer one is published. */
    fun skipPendingVersion() {
        val version = _state.value.update?.version ?: return
        scope.launch { preferences.skipVersion(version) }
        _state.update { it.copy(promptVisible = false) }
    }

    fun setAutoCheckEnabled(enabled: Boolean) {
        _state.update { it.copy(autoCheckEnabled = enabled) }
        scope.launch { preferences.setAutoCheckEnabled(enabled) }
    }

    private companion object {
        const val CHECK_INTERVAL_MILLIS = 12L * 60 * 60 * 1000
        const val UNSUPPORTED_MESSAGE =
            "This build does not receive GitHub releases. Install a release build to auto-update."
    }
}
