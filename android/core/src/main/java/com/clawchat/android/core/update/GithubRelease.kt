package com.clawchat.android.core.update

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** A GitHub release as returned by `GET /repos/{owner}/{repo}/releases`. */
@Serializable
data class GithubRelease(
    @SerialName("tag_name") val tagName: String,
    val name: String? = null,
    val body: String? = null,
    val draft: Boolean = false,
    val prerelease: Boolean = false,
    @SerialName("published_at") val publishedAt: String? = null,
    @SerialName("html_url") val htmlUrl: String? = null,
    val assets: List<GithubReleaseAsset> = emptyList(),
)

/** A file attached to a GitHub release. */
@Serializable
data class GithubReleaseAsset(
    val name: String,
    val size: Long = 0,
    @SerialName("browser_download_url") val browserDownloadUrl: String,
    @SerialName("content_type") val contentType: String? = null,
)
