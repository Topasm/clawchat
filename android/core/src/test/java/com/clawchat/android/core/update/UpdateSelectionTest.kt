package com.clawchat.android.core.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class UpdateSelectionTest {

    private fun apk(name: String = "ClawChat-0.2.0.apk", size: Long = 1024) =
        GithubReleaseAsset(name = name, size = size, browserDownloadUrl = "https://example.test/$name")

    private fun checksum(apkName: String = "ClawChat-0.2.0.apk") = GithubReleaseAsset(
        name = "$apkName.sha256",
        browserDownloadUrl = "https://example.test/$apkName.sha256",
    )

    private fun installableAssets(version: String, size: Long = 1024): List<GithubReleaseAsset> {
        val apkName = "ClawChat-$version.apk"
        return listOf(apk(apkName, size), checksum(apkName))
    }

    private fun release(
        tag: String,
        assets: List<GithubReleaseAsset> = installableAssets("0.2.0"),
        draft: Boolean = false,
        prerelease: Boolean = false,
        body: String? = "notes",
    ) = GithubRelease(
        tagName = tag,
        name = tag,
        body = body,
        draft = draft,
        prerelease = prerelease,
        htmlUrl = "https://example.test/releases/$tag",
        assets = assets,
    )

    @Test
    fun `selects the newest supported release with an apk`() {
        val update = UpdateSelection.selectUpdate(
            listOf(
                release("android-v0.1.5", installableAssets("0.1.5")),
                release("clawchat-v0.3.0", installableAssets("0.3.0", size = 4096)),
                release("android-v0.2.0", installableAssets("0.2.0")),
            ),
            currentVersion = "0.1.0",
        )

        assertEquals("0.3.0", update?.version)
        assertEquals("clawchat-v0.3.0", update?.tag)
        assertEquals("ClawChat-0.3.0.apk", update?.fileName)
        assertEquals(4096L, update?.sizeBytes)
        assertEquals("https://example.test/ClawChat-0.3.0.apk", update?.downloadUrl)
    }

    @Test
    fun `supports legacy android-only release tags`() {
        val update = UpdateSelection.selectUpdate(
            listOf(release("android-v0.2.0", installableAssets("0.2.0"))),
            currentVersion = "0.1.0",
        )

        assertEquals("0.2.0", update?.version)
        assertEquals("android-v0.2.0", update?.tag)
    }

    @Test
    fun `a newer legacy release still wins over an older unified release`() {
        val update = UpdateSelection.selectUpdate(
            listOf(
                release("clawchat-v0.2.0", installableAssets("0.2.0")),
                release("android-v0.3.0", installableAssets("0.3.0")),
            ),
            currentVersion = "0.1.0",
        )

        assertEquals("android-v0.3.0", update?.tag)
    }

    @Test
    fun `the unified stream wins a same-version tie regardless of API order`() {
        val unified = release("clawchat-v0.2.0", installableAssets("0.2.0"))
        val legacy = release("android-v0.2.0", installableAssets("0.2.0"))

        for (releases in listOf(listOf(unified, legacy), listOf(legacy, unified))) {
            val update = UpdateSelection.selectUpdate(releases, currentVersion = "0.1.0")
            assertEquals("clawchat-v0.2.0", update?.tag)
        }
    }

    @Test
    fun `ignores desktop-only unified releases without an apk`() {
        val desktopAsset = GithubReleaseAsset(
            name = "ClawChat_9.9.9_x64.dmg",
            size = 4096,
            browserDownloadUrl = "https://example.test/ClawChat_9.9.9_x64.dmg",
        )
        val update = UpdateSelection.selectUpdate(
            listOf(release("clawchat-v9.9.9", listOf(desktopAsset))),
            currentVersion = "0.1.0",
        )

        assertNull(update)
    }

    @Test
    fun `falls back to a legacy Android release when a newer unified release is desktop-only`() {
        val desktopAsset = GithubReleaseAsset(
            name = "ClawChat_0.3.0_x64.dmg",
            size = 4096,
            browserDownloadUrl = "https://example.test/ClawChat_0.3.0_x64.dmg",
        )
        val update = UpdateSelection.selectUpdate(
            listOf(
                release("clawchat-v0.3.0", listOf(desktopAsset)),
                release("android-v0.2.0", installableAssets("0.2.0")),
            ),
            currentVersion = "0.1.0",
        )

        assertEquals("android-v0.2.0", update?.tag)
    }

    @Test
    fun `ignores an apk whose file version disagrees with its release tag`() {
        val update = UpdateSelection.selectUpdate(
            listOf(release("clawchat-v0.3.0", listOf(apk("ClawChat-9.9.9.apk")))),
            currentVersion = "0.1.0",
        )

        assertNull(update)
    }

    @Test
    fun `ignores an apk without its matching checksum asset`() {
        val update = UpdateSelection.selectUpdate(
            listOf(release("clawchat-v0.3.0", listOf(apk("ClawChat-0.3.0.apk")))),
            currentVersion = "0.1.0",
        )

        assertNull(update)
    }

    @Test
    fun `ignores drafts, prereleases, and releases without an apk`() {
        val releases = listOf(
            release("android-v0.4.0", draft = true),
            release("android-v0.5.0", prerelease = true),
            release("android-v0.6.0", assets = listOf(apk("ClawChat-0.6.0.aab"))),
        )

        assertNull(UpdateSelection.selectUpdate(releases, currentVersion = "0.1.0"))
    }

    @Test
    fun `reports nothing when the installed build is current or newer`() {
        val releases = listOf(release("android-v0.2.0"))

        assertNull(UpdateSelection.selectUpdate(releases, currentVersion = "0.2.0"))
        assertNull(UpdateSelection.selectUpdate(releases, currentVersion = "0.3.0"))
    }

    @Test
    fun `an unparsable installed version never yields an update`() {
        assertNull(UpdateSelection.selectUpdate(listOf(release("android-v0.2.0")), "not-a-version"))
    }

    @Test
    fun `attaches the matching sha256 asset and release notes`() {
        val apkAsset = apk("ClawChat-0.2.0.apk")
        val update = UpdateSelection.selectUpdate(
            listOf(
                release(
                    "android-v0.2.0",
                    assets = listOf(
                        apkAsset,
                        GithubReleaseAsset(
                            name = "ClawChat-0.2.0.apk.sha256",
                            browserDownloadUrl = "https://example.test/ClawChat-0.2.0.apk.sha256",
                        ),
                        GithubReleaseAsset(
                            name = "ClawChat-0.2.0.aab",
                            browserDownloadUrl = "https://example.test/ClawChat-0.2.0.aab",
                        ),
                    ),
                    body = "  Fixes  ",
                ),
            ),
            currentVersion = "0.1.0",
        )

        assertEquals("https://example.test/ClawChat-0.2.0.apk.sha256", update?.checksumUrl)
        assertEquals("Fixes", update?.releaseNotes)
        assertEquals("https://example.test/releases/android-v0.2.0", update?.releaseUrl)
    }
}
