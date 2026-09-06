package com.clawchat.android.feature.chat

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatEntrySelectionTest {
    @Test fun `first entry selects the requested conversation`() {
        assertTrue(shouldSelectInitialConversation("project", null, false))
        assertTrue(shouldSelectInitialConversation("task", "project", false))
    }

    @Test fun `reopening an existing thread does not reset its streaming state`() {
        assertFalse(shouldSelectInitialConversation("project", "project", false))
        assertFalse(shouldSelectInitialConversation("project", "project", true))
    }

    @Test fun `process recreation restores even when the consumed flag survived`() {
        assertTrue(shouldSelectInitialConversation("project", null, true))
    }

    @Test fun `consumed entry does not override a later user selection or create a global chat`() {
        assertFalse(shouldSelectInitialConversation("project", "another", true))
        assertFalse(shouldSelectInitialConversation(null, null, false))
    }
}
