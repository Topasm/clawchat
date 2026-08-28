package com.clawchat.android.core.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppVersionTest {

    @Test
    fun `parses plain, prefixed, and release tag versions`() {
        val expected = AppVersion(0, 2, 1)
        assertEquals(expected, AppVersion.parse("0.2.1"))
        assertEquals(expected, AppVersion.parse("v0.2.1"))
        assertEquals(expected, AppVersion.parse("android-v0.2.1"))
        assertEquals(expected, AppVersion.parse(" android-v0.2.1 "))
    }

    @Test
    fun `rejects values that are not semantic versions`() {
        assertNull(AppVersion.parse(null))
        assertNull(AppVersion.parse(""))
        assertNull(AppVersion.parse("1.2"))
        assertNull(AppVersion.parse("clawchat-v1.2.3"))
        assertNull(AppVersion.parse("1.2.3.4"))
    }

    @Test
    fun `orders by major, minor, and patch`() {
        assertTrue(AppVersion.parse("1.0.0")!! > AppVersion.parse("0.9.9")!!)
        assertTrue(AppVersion.parse("0.10.0")!! > AppVersion.parse("0.9.0")!!)
        assertTrue(AppVersion.parse("0.1.10")!! > AppVersion.parse("0.1.9")!!)
        assertEquals(0, AppVersion.parse("0.1.0")!!.compareTo(AppVersion.parse("0.1.0")!!))
    }

    @Test
    fun `a prerelease precedes the release it leads to`() {
        assertTrue(AppVersion.parse("1.0.0-rc.1")!! < AppVersion.parse("1.0.0")!!)
        assertTrue(AppVersion.parse("1.0.0-rc.2")!! > AppVersion.parse("1.0.0-rc.1")!!)
        assertTrue(AppVersion.parse("1.0.0")!! > AppVersion.parse("0.9.0-rc.1")!!)
    }

    @Test
    fun `build metadata does not change the version`() {
        assertEquals(AppVersion(1, 2, 3), AppVersion.parse("1.2.3+ci.42"))
    }
}
