package com.clawchat.android.core.update

/** A published Android release that is newer than the running build. */
data class AvailableUpdate(
    val version: String,
    val tag: String,
    val fileName: String,
    val downloadUrl: String,
    val sizeBytes: Long,
    /** Asset holding the APK's SHA-256 digest, when the release published one. */
    val checksumUrl: String?,
    val releaseNotes: String,
    val releaseUrl: String?,
)

/**
 * Picks the newest installable Android release out of a GitHub release list.
 *
 * The same repository also publishes desktop releases, so a release only
 * qualifies when it is a published (non-draft, non-prerelease) `android-v*`
 * tag that actually carries an APK, and when its version is strictly newer
 * than the installed one.
 */
object UpdateSelection {

    private const val APK_SUFFIX = ".apk"
    private const val CHECKSUM_SUFFIX = ".sha256"

    fun selectUpdate(releases: List<GithubRelease>, currentVersion: String): AvailableUpdate? {
        val current = AppVersion.parse(currentVersion) ?: return null
        return releases
            .asSequence()
            .filterNot { it.draft || it.prerelease }
            .filter { it.tagName.startsWith(ANDROID_RELEASE_TAG_PREFIX) }
            .mapNotNull { release ->
                val version = AppVersion.parse(release.tagName) ?: return@mapNotNull null
                if (version <= current) return@mapNotNull null
                toAvailableUpdate(release)?.let { version to it }
            }
            .maxByOrNull { (version, _) -> version }
            ?.second
    }

    private fun toAvailableUpdate(release: GithubRelease): AvailableUpdate? {
        val apk = release.assets.firstOrNull { it.name.endsWith(APK_SUFFIX, ignoreCase = true) }
            ?: return null
        val checksum = release.assets.firstOrNull {
            it.name.equals(apk.name + CHECKSUM_SUFFIX, ignoreCase = true)
        }
        return AvailableUpdate(
            version = release.tagName.removePrefix(ANDROID_RELEASE_TAG_PREFIX),
            tag = release.tagName,
            fileName = apk.name,
            downloadUrl = apk.browserDownloadUrl,
            sizeBytes = apk.size,
            checksumUrl = checksum?.browserDownloadUrl,
            releaseNotes = release.body.orEmpty().trim(),
            releaseUrl = release.htmlUrl,
        )
    }
}
