package com.clawchat.android.core.update

import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import retrofit2.HttpException
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

sealed interface UpdateCheckResult {
    data class Success(val update: AvailableUpdate?) : UpdateCheckResult
    data class Failure(val failure: UpdateFailure) : UpdateCheckResult
}

/** Reads published GitHub releases and reports the newest installable one. */
interface AppUpdateRepository {
    /** Success with null means the running build is already the newest release. */
    suspend fun findUpdate(): UpdateCheckResult
}

@Singleton
class AppUpdateRepositoryImpl @Inject constructor(
    private val api: GithubReleaseApi,
    private val config: UpdateConfig,
) : AppUpdateRepository {

    override suspend fun findUpdate(): UpdateCheckResult {
        if (!config.isValid) {
            return UpdateCheckResult.Failure(UpdateFailure.UnsupportedBuild)
        }
        return try {
            val releases = api.listReleases(config.owner, config.name, RELEASE_PAGE_SIZE)
            UpdateCheckResult.Success(
                UpdateSelection.selectUpdate(releases, config.currentVersion),
            )
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: HttpException) {
            UpdateCheckResult.Failure(
                UpdateFailure.CheckHttpError(
                    statusCode = error.code(),
                    detail = error.safeServerDetail(),
                ),
            )
        } catch (_: IOException) {
            // IOException messages are platform-generated and commonly English.
            // The stable category gives the UI a fully localizable explanation.
            UpdateCheckResult.Failure(UpdateFailure.CheckNetworkFailed)
        } catch (_: Exception) {
            UpdateCheckResult.Failure(UpdateFailure.CheckFailed())
        }
    }

    private companion object {
        // Android and desktop releases share one repository, so the page has to
        // be deep enough to still contain Android tags after a desktop run.
        const val RELEASE_PAGE_SIZE = 30
    }
}

/** Retains only GitHub's bounded JSON message, never a locally generated exception string. */
private fun HttpException.safeServerDetail(): String? = runCatching {
    val rawBody = response()?.errorBody()?.string()?.take(MAX_ERROR_BODY_LENGTH) ?: return null
    Json.parseToJsonElement(rawBody)
        .jsonObject["message"]
        ?.jsonPrimitive
        ?.contentOrNull
        ?.let(::safeUpdateFailureDetail)
}.getOrNull()

private const val MAX_ERROR_BODY_LENGTH = 64 * 1024
