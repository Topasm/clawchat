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

        /** Parse `0.2.0`, `v0.2.0`, or `android-v0.2.0`; null when the input is not a version. */
        fun parse(raw: String?): AppVersion? {
            val trimmed = raw?.trim()?.removePrefix(ANDROID_RELEASE_TAG_PREFIX)?.removePrefix("v")
            val match = trimmed?.let { PATTERN.matchEntire(it) } ?: return null
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
 * Tag prefix for Android releases. Desktop releases live in the same
 * repository under `clawchat-v*`, and they carry no APK, so the updater only
 * ever considers tags with this prefix.
 */
const val ANDROID_RELEASE_TAG_PREFIX = "android-v"
