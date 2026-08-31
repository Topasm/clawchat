package com.clawchat.android.core.update

/**
 * A release version parsed from a semantic version string.
 *
 * The updater compares GitHub release tags against the installed
 * [android.content.pm.PackageInfo.versionName], so parsing has to be lenient
 * about a leading `v` and about the release tag prefix, and strict about
 * everything else: an unparsable version is never treated as an update.
 */
data class AppVersion(
    val major: Int,
    val minor: Int,
    val patch: Int,
    val preRelease: String? = null,
) : Comparable<AppVersion> {

    override fun compareTo(other: AppVersion): Int {
        major.compareTo(other.major).let { if (it != 0) return it }
        minor.compareTo(other.minor).let { if (it != 0) return it }
        patch.compareTo(other.patch).let { if (it != 0) return it }
        // A pre-release always precedes the release it leads to (1.0.0-rc.1 < 1.0.0).
        return when {
            preRelease == null && other.preRelease == null -> 0
            preRelease == null -> 1
            other.preRelease == null -> -1
            else -> preRelease.compareTo(other.preRelease)
        }
    }

    override fun toString(): String = buildString {
        append(major).append('.').append(minor).append('.').append(patch)
        preRelease?.let { append('-').append(it) }
    }

    companion object {
        private val PATTERN =
            Regex("""^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$""")

        /**
         * Parse a plain version or one from either the unified (`clawchat-v*`) or legacy
         * Android (`android-v*`) release stream; null when the input is not a version.
         */
        fun parse(raw: String?): AppVersion? {
            val trimmed = raw?.trim() ?: return null
            val version = when {
                trimmed.startsWith(CLAWCHAT_RELEASE_TAG_PREFIX) ->
                    trimmed.removePrefix(CLAWCHAT_RELEASE_TAG_PREFIX)
                trimmed.startsWith(ANDROID_RELEASE_TAG_PREFIX) ->
                    trimmed.removePrefix(ANDROID_RELEASE_TAG_PREFIX)
                trimmed.startsWith("v") -> trimmed.removePrefix("v")
                else -> trimmed
            }
            val match = PATTERN.matchEntire(version) ?: return null
            return AppVersion(
                major = match.groupValues[1].toInt(),
                minor = match.groupValues[2].toInt(),
                patch = match.groupValues[3].toInt(),
                preRelease = match.groupValues[4].takeIf { it.isNotEmpty() },
            )
        }
    }
}

/**
 * Release tag prefixes understood by the Android updater. New releases share
 * the `clawchat-v*` stream with desktop builds; `android-v*` remains supported
 * so existing installations can still discover older Android-only releases.
 */
const val CLAWCHAT_RELEASE_TAG_PREFIX = "clawchat-v"
const val ANDROID_RELEASE_TAG_PREFIX = "android-v"
