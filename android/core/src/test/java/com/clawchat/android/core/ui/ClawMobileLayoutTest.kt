package com.clawchat.android.core.ui

import org.junit.Assert.*
import org.junit.Test

class ClawMobileLayoutTest {
    @Test fun `compact layout preserves touch targets and readable input space`() {
        assertEquals(16f, ClawMobileLayout.PageInset.value)
        assertTrue(ClawMobileLayout.TouchTarget.value >= 48f)
        assertEquals(24f, ClawMobileLayout.IconSize.value)
        assertEquals(4, ClawMobileLayout.ComposerLines)
        assertEquals(3, ClawMobileLayout.MaxOutlineIndent)
    }
}
