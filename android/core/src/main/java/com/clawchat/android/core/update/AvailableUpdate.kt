package com.clawchat.android.core.update

/** A published Android release that is newer than the running build. */
data class AvailableUpdate(
    val version: String,
    val tag: String,
    val fileName: String,
    val downloadUrl: String,
    val sizeBytes: Long,
    /** Asset holding the APK's required SHA-256 digest. */
    val checksumUrl: String,
    val releaseNotes: String,
    val releaseUrl: String?,
)

/**
 * Picks the newest installable Android release out of a GitHub release list.
 *
 * The same repository also publishes desktop releases, so a release only
 * qualifies when it is published (non-draft, non-prerelease), uses either the
 * unified `clawchat-v*` tag or legacy `android-v*` tag, carries the APK named
 * for that exact version with its SHA-256 asset, and is strictly newer than
 * the installed version. The unified stream wins only when both streams
 * contain the same version.
 */
object UpdateSelection {

    private const val APK_SUFFIX = ".apk"
    private const val CHECKSUM_SUFFIX = ".sha256"
    private const val UNIFIED_RELEASE_PRIORITY = 1
    private const val LEGACY_RELEASE_PRIORITY = 0

    private data class ParsedRelease(
        val version: AppVersion,
        val versionName: String,
        val priority: Int,
    )

    private data class Candidate(
        val release: ParsedRelease,
        val update: AvailableUpdate,
    )

    fun selectUpdate(releases: List<GithubRelease>, currentVersion: String): AvailableUpdate? {
        val current = AppVersion.parse(currentVersion) ?: return null
        return releases
            .asSequence()
            .filterNot { it.draft || it.prerelease }
            .mapNotNull { release ->
                val parsed = parseReleaseTag(release.tagName) ?: return@mapNotNull null
                if (parsed.version <= current) return@mapNotNull null
                toAvailableUpdate(release, parsed.versionName)?.let { Candidate(parsed, it) }
            }
            .maxWithOrNull(
                compareBy<Candidate> { it.release.version }
                    .thenBy { it.release.priority },
            )
            ?.update
    }

    private fun parseReleaseTag(tagName: String): ParsedRelease? {
        val (versionName, priority) = when {
            tagName.startsWith(CLAWCHAT_RELEASE_TAG_PREFIX) ->
                tagName.removePrefix(CLAWCHAT_RELEASE_TAG_PREFIX) to UNIFIED_RELEASE_PRIORITY
            tagName.startsWith(ANDROID_RELEASE_TAG_PREFIX) ->
                tagName.removePrefix(ANDROID_RELEASE_TAG_PREFIX) to LEGACY_RELEASE_PRIORITY
            else -> return null
        }
        val version = AppVersion.parse(versionName) ?: return null
        return ParsedRelease(version, versionName, priority)
    }

    private fun toAvailableUpdate(
        release: GithubRelease,
        versionName: String,
    ): AvailableUpdate? {
        // A release can contain arbitrary APK assets. Only the APK whose name
        // agrees with the tag is safe to present as that version.
        val expectedApkName = "ClawChat-$versionName$APK_SUFFIX"
        val apk = release.assets.singleOrNull { it.name == expectedApkName }
            ?: return null
        val checksum = release.assets.firstOrNull {
            it.name.equals(apk.name + CHECKSUM_SUFFIX, ignoreCase = true)
        } ?: return null
        return AvailableUpdate(
            version = versionName,
            tag = release.tagName,
            fileName = apk.name,
            downloadUrl = apk.browserDownloadUrl,
            sizeBytes = apk.size,
            checksumUrl = checksum.browserDownloadUrl,
            releaseNotes = release.body.orEmpty().trim(),
            releaseUrl = release.htmlUrl,
        )
    }
}
