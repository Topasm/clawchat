package com.clawchat.android.core.update

import android.content.Context
import android.content.Intent
import android.provider.Settings
import androidx.core.content.FileProvider
import androidx.core.net.toUri
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/** Hands a downloaded APK to the system package installer. */
interface ApkInstaller {
    /** False when the user has not granted "install unknown apps" to ClawChat. */
    fun canInstallPackages(): Boolean

    /** Opens the system screen that grants the install permission. */
    fun requestInstallPermission()

    /** Opens the system installer for [file]. */
    fun install(file: File)
}

@Singleton
class ApkInstallerImpl @Inject constructor(
    @param:ApplicationContext private val context: Context,
) : ApkInstaller {

    override fun canInstallPackages(): Boolean = context.packageManager.canRequestPackageInstalls()

    override fun requestInstallPermission() {
        val intent = Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            "package:${context.packageName}".toUri(),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }

    override fun install(file: File) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", file)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(intent)
    }
}
