package com.clawchat.android.share

internal const val MAX_SHARED_FILE_BYTES: Long = 10L * 1024 * 1024
internal const val MAX_SHARED_TOTAL_BYTES: Long = 50L * 1024 * 1024
internal const val MAX_SHARED_FILES: Int = 10

internal data class ValidatedSharedFile(
    val displayName: String,
    val extension: String,
    val mimeType: String,
)

internal sealed interface SharedFileValidation {
    data class Accepted(val file: ValidatedSharedFile) : SharedFileValidation
    data object UnsupportedType : SharedFileValidation
    data object MimeTypeMismatch : SharedFileValidation
    data object TooLarge : SharedFileValidation
}

/** Validation shared by every Android share provider before its URI is opened. */
internal object ShareCapturePolicy {
    private const val MAX_DISPLAY_NAME_LENGTH = 120
    private const val MAX_TITLE_LENGTH = 200
    private const val MAX_DESCRIPTION_LENGTH = 10_000
    private const val GENERIC_MIME = "application/octet-stream"

    private val mimeTypesByExtension = mapOf(
        "jpg" to setOf("image/jpeg"),
        "jpeg" to setOf("image/jpeg"),
        "png" to setOf("image/png"),
        "gif" to setOf("image/gif"),
        "webp" to setOf("image/webp"),
        "svg" to setOf("image/svg+xml"),
        "pdf" to setOf("application/pdf"),
        "txt" to setOf("text/plain"),
        "md" to setOf("text/markdown", "text/plain"),
        "zip" to setOf("application/zip", "application/x-zip-compressed"),
    )

    private val preferredExtensionByMime = mapOf(
        "image/jpeg" to "jpg",
        "image/png" to "png",
        "image/gif" to "gif",
        "image/webp" to "webp",
        "image/svg+xml" to "svg",
        "application/pdf" to "pdf",
        "text/plain" to "txt",
        "text/markdown" to "md",
        "application/zip" to "zip",
        "application/x-zip-compressed" to "zip",
    )

    fun validateFile(
        rawDisplayName: String?,
        rawMimeType: String?,
        reportedSize: Long?,
        fallbackIndex: Int,
    ): SharedFileValidation {
        if (reportedSize != null && reportedSize > MAX_SHARED_FILE_BYTES) {
            return SharedFileValidation.TooLarge
        }

        val mimeType = normalizeMime(rawMimeType)
        var displayName = sanitizeDisplayName(rawDisplayName)
        var extension = displayName.extension()

        if (extension !in mimeTypesByExtension) {
            val inferredExtension = preferredExtensionByMime[mimeType]
                ?: return SharedFileValidation.UnsupportedType
            if (extension.isNotEmpty()) return SharedFileValidation.UnsupportedType
            extension = inferredExtension
            val baseName = displayName.ifBlank { "shared-$fallbackIndex" }
            displayName = "$baseName.$extension"
        }

        val allowedMimeTypes = mimeTypesByExtension.getValue(extension)
        if (mimeType != null && mimeType != GENERIC_MIME && mimeType !in allowedMimeTypes) {
            return SharedFileValidation.MimeTypeMismatch
        }

        return SharedFileValidation.Accepted(
            ValidatedSharedFile(
                displayName = boundDisplayName(displayName, extension),
                extension = extension,
                mimeType = mimeType
                    ?.takeUnless { it == GENERIC_MIME }
                    ?: allowedMimeTypes.first(),
            ),
        )
    }

    fun taskTitle(
        subject: String?,
        text: String?,
        fileNames: List<String>,
        multipleFilesTitle: (Int) -> String = { count -> "$count shared files" },
    ): String? {
        val subjectTitle = normalizeText(subject)?.lineSequence()?.firstOrNull()?.trim()
        if (!subjectTitle.isNullOrEmpty()) return subjectTitle.take(MAX_TITLE_LENGTH)

        val sharedText = normalizeText(text)
        if (sharedText != null) {
            return sharedText.lineSequence().first().trim().take(MAX_TITLE_LENGTH)
        }

        return when (fileNames.size) {
            0 -> null
            1 -> fileNames.first().take(MAX_TITLE_LENGTH)
            else -> multipleFilesTitle(fileNames.size).take(MAX_TITLE_LENGTH)
        }
    }

    fun taskDescription(subject: String?, text: String?): String? {
        val sharedText = normalizeText(text) ?: return null
        val normalizedSubject = normalizeText(subject)
        val titleWasTruncated = sharedText.lineSequence().first().length > MAX_TITLE_LENGTH
        return sharedText
            .takeIf { normalizedSubject != null || titleWasTruncated || it.contains('\n') }
            ?.take(MAX_DESCRIPTION_LENGTH)
    }

    private fun normalizeMime(value: String?): String? = value
        ?.substringBefore(';')
        ?.trim()
        ?.lowercase()
        ?.takeIf { it.isNotEmpty() && !it.endsWith("/*") }

    private fun normalizeText(value: String?): String? = value
        ?.replace('\u0000', ' ')
        ?.trim()
        ?.takeIf(String::isNotEmpty)

    private fun sanitizeDisplayName(value: String?): String {
        val leafName = value
            ?.substringAfterLast('/')
            ?.substringAfterLast('\\')
            .orEmpty()
        return leafName
            .replace(Regex("[\\p{Cc}<>:\"|?*]"), "_")
            .trim(' ', '.')
            .take(MAX_DISPLAY_NAME_LENGTH * 4)
    }

    private fun boundDisplayName(value: String, extension: String): String {
        val suffix = ".$extension"
        val baseName = value.substringBeforeLast('.', value).trimEnd(' ', '.')
        val boundedBase = baseName
            .ifBlank { "shared" }
            .take((MAX_DISPLAY_NAME_LENGTH - suffix.length).coerceAtLeast(1))
        return "$boundedBase$suffix"
    }

    private fun String.extension(): String = substringAfterLast('.', "").lowercase()
}
