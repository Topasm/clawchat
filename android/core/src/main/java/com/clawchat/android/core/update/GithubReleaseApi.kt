package com.clawchat.android.core.update

import retrofit2.http.GET
import retrofit2.http.Headers
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * The public GitHub releases API. It needs no credentials, which keeps the
 * updater usable on a device that has never paired with a server.
 */
interface GithubReleaseApi {

    @Headers(
        "Accept: application/vnd.github+json",
        "X-GitHub-Api-Version: 2022-11-28",
    )
    @GET("repos/{owner}/{repo}/releases")
    suspend fun listReleases(
        @Path("owner") owner: String,
        @Path("repo") repo: String,
        @Query("per_page") perPage: Int,
    ): List<GithubRelease>
}
