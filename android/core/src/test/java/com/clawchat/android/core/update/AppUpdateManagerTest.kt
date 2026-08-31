package com.clawchat.android.core.update

import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.File
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class AppUpdateManagerTest {

    private val update = AvailableUpdate(
        version = "0.2.0",
        tag = "android-v0.2.0",
        fileName = "ClawChat-0.2.0.apk",
        downloadUrl = "https://example.test/ClawChat-0.2.0.apk",
        sizeBytes = 2048,
        checksumUrl = "https://example.test/ClawChat-0.2.0.apk.sha256",
        releaseNotes = "Notes",
        releaseUrl = "https://example.test/releases/android-v0.2.0",
    )

    private class FakeRepository(var result: UpdateCheckResult) : AppUpdateRepository {
        var calls = 0
        override suspend fun findUpdate(): UpdateCheckResult {
            calls++
            return result
        }
    }

    private class FakeDownloader(
        private val file: File? = File("/tmp/ClawChat-0.2.0.apk"),
        private val failure: Throwable? = null,
    ) : UpdateDownloader {
        override suspend fun download(
            update: AvailableUpdate,
            onProgress: (downloaded: Long, total: Long) -> Unit,
        ): File {
            onProgress(0, update.sizeBytes)
            failure?.let { throw it }
            onProgress(update.sizeBytes, update.sizeBytes)
            return file!!
        }
    }

    private class FakeInstaller(
        var permitted: Boolean = true,
        private val permissionFailure: RuntimeException? = null,
        private val installFailure: RuntimeException? = null,
    ) : ApkInstaller {
        var installed: File? = null
        var permissionRequests = 0
        override fun canInstallPackages(): Boolean = permitted
        override fun requestInstallPermission() {
            permissionRequests++
            permissionFailure?.let { throw it }
        }
        override fun install(file: File) {
            installFailure?.let { throw it }
            installed = file
        }
    }

    private fun preferences(
        autoCheck: Boolean = true,
        lastCheckedAt: Long = 0,
        skipped: String? = null,
    ): UpdatePreferences = mockk<UpdatePreferences>(relaxed = true).also {
        coEvery { it.isAutoCheckEnabled() } returns autoCheck
        coEvery { it.lastCheckedAtMillis() } returns lastCheckedAt
        coEvery { it.skippedVersion() } returns skipped
    }

    private fun config(version: String = "0.1.0", enabled: Boolean = true) = UpdateConfig(
        repository = "Topasm/clawchat",
        currentVersion = version,
        enabled = enabled,
    )

    // The manager owns a process-lifetime scope in production; tests give it one
    // driven by the test scheduler so advanceUntilIdle() runs its work.
    private fun TestScope.manager(
        repository: AppUpdateRepository,
        downloader: UpdateDownloader = FakeDownloader(),
        installer: ApkInstaller = FakeInstaller(),
        preferences: UpdatePreferences = preferences(),
        config: UpdateConfig = config(),
        scope: CoroutineScope = CoroutineScope(StandardTestDispatcher(testScheduler)),
        now: Long = 1_000_000L,
    ) = AppUpdateManager(
        repository = repository,
        downloader = downloader,
        installer = installer,
        preferences = preferences,
        config = config,
        scope = scope,
        clock = { now },
    )

    @Test
    fun `a manual check surfaces the newest release and prompts`() = runTest {
        val repository = FakeRepository(UpdateCheckResult.Success(update))
        val manager = manager(repository)

        manager.checkForUpdate()
        advanceUntilIdle()

        val state = manager.state.value
        assertEquals(UpdatePhase.Available, state.phase)
        assertEquals("0.2.0", state.update?.version)
        assertEquals("0.1.0", state.currentVersion)
        assertTrue(state.promptVisible)
    }

    @Test
    fun `a manual check reports being up to date`() = runTest {
        val repository = FakeRepository(UpdateCheckResult.Success(null))
        val manager = manager(repository)

        manager.checkForUpdate()
        advanceUntilIdle()

        assertEquals(UpdatePhase.UpToDate, manager.state.value.phase)
        assertNull(manager.state.value.update)
    }

    @Test
    fun `a manual failure is reported, an automatic one stays silent`() = runTest {
        val repository = FakeRepository(
            UpdateCheckResult.Failure(UpdateFailure.CheckFailed("Network error")),
        )

        val manual = manager(repository)
        manual.checkForUpdate()
        advanceUntilIdle()
        assertEquals(UpdatePhase.Failed, manual.state.value.phase)
        assertEquals(
            UpdateFailure.CheckFailed("Network error"),
            manual.state.value.failure,
        )

        val automatic = manager(repository)
        automatic.checkForUpdateIfDue()
        advanceUntilIdle()
        assertEquals(UpdatePhase.Idle, automatic.state.value.phase)
        assertNull(automatic.state.value.failure)
    }

    @Test
    fun `an automatic check is throttled and records the attempt`() = runTest {
        val repository = FakeRepository(UpdateCheckResult.Success(update))
        val recent = preferences(lastCheckedAt = 1_000_000L - 60_000L)
        val throttled = manager(repository, preferences = recent)

        throttled.checkForUpdateIfDue()
        advanceUntilIdle()
        assertEquals(0, repository.calls)

        val stale = preferences(lastCheckedAt = 1_000_000L - 13L * 60 * 60 * 1000)
        val due = manager(repository, preferences = stale)
        due.checkForUpdateIfDue()
        advanceUntilIdle()

        assertEquals(1, repository.calls)
        coVerify(exactly = 1) { stale.recordCheckedAt(1_000_000L) }
    }

    @Test
    fun `an automatic check honours the disabled preference`() = runTest {
        val repository = FakeRepository(UpdateCheckResult.Success(update))
        val manager = manager(
            repository,
            preferences = preferences(autoCheck = false),
        )

        manager.checkForUpdateIfDue()
        advanceUntilIdle()

        assertEquals(0, repository.calls)
        assertFalse(manager.state.value.autoCheckEnabled)
    }

    @Test
    fun `a skipped version is still reported but never prompts automatically`() = runTest {
        val repository = FakeRepository(UpdateCheckResult.Success(update))
        val manager = manager(
            repository,
            preferences = preferences(skipped = "0.2.0"),
        )

        manager.checkForUpdateIfDue()
        advanceUntilIdle()

        assertEquals(UpdatePhase.Available, manager.state.value.phase)
        assertFalse(manager.state.value.promptVisible)
    }

    @Test
    fun `skipping the pending version persists it and closes the prompt`() = runTest {
        val repository = FakeRepository(UpdateCheckResult.Success(update))
        val preferences = preferences()
        val manager = manager(repository, preferences = preferences)

        manager.checkForUpdate()
        advanceUntilIdle()
        manager.skipPendingVersion()
        advanceUntilIdle()

        assertFalse(manager.state.value.promptVisible)
        coVerify(exactly = 1) { preferences.skipVersion("0.2.0") }
    }

    @Test
    fun `a download reports progress and ends ready to install`() = runTest {
        val repository = FakeRepository(UpdateCheckResult.Success(update))
        val manager = manager(repository)

        manager.checkForUpdate()
        advanceUntilIdle()
        manager.downloadUpdate()
        advanceUntilIdle()

        val state = manager.state.value
        assertEquals(UpdatePhase.ReadyToInstall, state.phase)
        assertEquals(2048L, state.downloadedBytes)
        assertEquals("ClawChat-0.2.0.apk", state.downloadedFile?.name)
    }

    @Test
    fun `a failed download reports the reason and stages no file`() = runTest {
        val repository = FakeRepository(UpdateCheckResult.Success(update))
        val manager = manager(
            repository,
            downloader = FakeDownloader(
                failure = UpdateDownloadException(
                    UpdateFailure.ChecksumMismatch,
                    "Update checksum mismatch",
                ),
            ),
        )

        manager.checkForUpdate()
        advanceUntilIdle()
        manager.downloadUpdate()
        advanceUntilIdle()

        assertEquals(UpdatePhase.Failed, manager.state.value.phase)
        assertEquals(UpdateFailure.ChecksumMismatch, manager.state.value.failure)
        assertNull(manager.state.value.downloadedFile)
    }

    @Test
    fun `an unexpected download failure keeps only a bounded single-line detail`() = runTest {
        val repository = FakeRepository(UpdateCheckResult.Success(update))
        val manager = manager(
            repository,
            downloader = FakeDownloader(failure = IOException("disk offline\nretry later")),
        )

        manager.checkForUpdate()
        advanceUntilIdle()
        manager.downloadUpdate()
        advanceUntilIdle()

        assertEquals(
            UpdateFailure.DownloadFailed("disk offline retry later"),
            manager.state.value.failure,
        )
    }

    @Test
    fun `installing asks for the permission first and installs once granted`() = runTest {
        val repository = FakeRepository(UpdateCheckResult.Success(update))
        val installer = FakeInstaller(permitted = false)
        val manager = manager(repository, installer = installer)

        manager.checkForUpdate()
        advanceUntilIdle()
        manager.downloadUpdate()
        advanceUntilIdle()
        manager.installUpdate()

        assertEquals(1, installer.permissionRequests)
        assertNull(installer.installed)
        assertTrue(manager.state.value.needsInstallPermission)

        installer.permitted = true
        manager.installUpdate()

        assertEquals("ClawChat-0.2.0.apk", installer.installed?.name)
        assertFalse(manager.state.value.needsInstallPermission)
    }

    @Test
    fun `install permission and installer launch failures use typed categories`() = runTest {
        val repository = FakeRepository(UpdateCheckResult.Success(update))
        val permissionInstaller = FakeInstaller(
            permitted = false,
            permissionFailure = IllegalStateException("settings unavailable"),
        )
        val permissionManager = manager(repository, installer = permissionInstaller)
        permissionManager.checkForUpdate()
        advanceUntilIdle()
        permissionManager.downloadUpdate()
        advanceUntilIdle()
        permissionManager.installUpdate()

        assertEquals(
            UpdateFailure.InstallPermissionFailed("settings unavailable"),
            permissionManager.state.value.failure,
        )

        val installInstaller = FakeInstaller(
            installFailure = IllegalStateException("installer unavailable"),
        )
        val installManager = manager(repository, installer = installInstaller)
        installManager.checkForUpdate()
        advanceUntilIdle()
        installManager.downloadUpdate()
        advanceUntilIdle()
        installManager.installUpdate()

        assertEquals(
            UpdateFailure.InstallLaunchFailed("installer unavailable"),
            installManager.state.value.failure,
        )
    }

    @Test
    fun `a build without updater wiring never reaches the network`() = runTest {
        val repository = FakeRepository(UpdateCheckResult.Success(update))
        val manager = manager(repository, config = config(enabled = false))

        manager.checkForUpdateIfDue()
        advanceUntilIdle()
        assertEquals(0, repository.calls)

        manager.checkForUpdate()
        advanceUntilIdle()
        assertEquals(0, repository.calls)
        assertEquals(UpdatePhase.Failed, manager.state.value.phase)
        assertFalse(manager.state.value.supported)
        assertEquals(UpdateFailure.UnsupportedBuild, manager.state.value.failure)
    }
}
