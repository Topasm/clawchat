package com.clawchat.android.share

import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.Build

internal data class IncomingSharePayload(
    val subject: String?,
    val text: String?,
    val streams: List<Uri>,
    val declaredMimeType: String?,
)

internal sealed interface ShareIntentParseResult {
    data object NotShare : ShareIntentParseResult
    data object Malformed : ShareIntentParseResult
    data class Accepted(val payload: IncomingSharePayload) : ShareIntentParseResult
}

internal object ShareIntentParser {
    fun parse(intent: Intent?): ShareIntentParseResult {
        intent ?: return ShareIntentParseResult.NotShare
        if (intent.action != Intent.ACTION_SEND && intent.action != Intent.ACTION_SEND_MULTIPLE) {
            return ShareIntentParseResult.NotShare
        }

        return try {
            val streams = buildList {
                if (intent.action == Intent.ACTION_SEND) {
                    intent.streamExtra()?.let(::add)
                } else {
                    addAll(intent.streamExtras())
                }
                addAll(intent.clipData.streamUris())
            }.distinctBy(Uri::toString)

            ShareIntentParseResult.Accepted(
                IncomingSharePayload(
                    subject = intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT)?.toString(),
                    text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
                        ?: intent.clipData.firstSharedText(),
                    streams = streams,
                    declaredMimeType = intent.type,
                ),
            )
        } catch (_: Exception) {
            // A sender controls the Parcelable extras. Never partially accept
            // a payload when unparcelling or a provider-defined object fails.
            ShareIntentParseResult.Malformed
        }
    }

    @Suppress("DEPRECATION")
    private fun Intent.streamExtra(): Uri? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
    } else {
        getParcelableExtra(Intent.EXTRA_STREAM)
    }

    @Suppress("DEPRECATION")
    private fun Intent.streamExtras(): List<Uri> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
        } else {
            getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty()
        }

    private fun ClipData?.streamUris(): List<Uri> = buildList {
        val data = this@streamUris ?: return@buildList
        repeat(data.itemCount) { index ->
            data.getItemAt(index).uri?.let(::add)
        }
    }

    private fun ClipData?.firstSharedText(): String? {
        val data = this ?: return null
        repeat(data.itemCount) { index ->
            data.getItemAt(index).text?.toString()?.let { return it }
        }
        return null
    }
}
