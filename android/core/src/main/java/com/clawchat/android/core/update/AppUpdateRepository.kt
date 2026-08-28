package com.clawchat.android.core.update

import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.apiCall
import javax.inject.Inject
import javax.inject.Singleton

/** Reads published GitHub releases and reports the newest installable one. */
interface AppUpdateRepository {
    /** Success with null means the running build is already the newest release. */
    suspend fun findUpdate(): ApiResult<AvailableUpdate?>
}

@Singleton
class AppUpdateRepositoryImpl @Inject constructor(
    private val api: GithubReleaseApi,
    private val config: UpdateConfig,
) : AppUpdateRepository {

    override suspend fun findUpdate(): ApiResult<AvailableUpdate?> {
        if (!config.isValid) {
            return ApiResult.Error("Updates are not configured for this build")
        }
        return apiCall {
            val releases = api.listReleases(config.owner, config.name, RELEASE_PAGE_SIZE)
            UpdateSelection.selectUpdate(releases, config.currentVersion)
        }
    }

    private companion object {
        // Android and desktop releases share one repository, so the page has to
        // be deep enough to still contain Android tags after a desktop run.
        const val RELEASE_PAGE_SIZE = 30
    }
}
