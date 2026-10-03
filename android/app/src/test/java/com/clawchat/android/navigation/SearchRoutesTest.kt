package com.clawchat.android.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SearchRoutesTest {

    @Test
    fun `each hit type opens the screen that lists it`() {
        assertEquals(NavRoute.Tasks.route, searchHitRoute("todo"))
        assertEquals(NavRoute.Calendar.route, searchHitRoute("event"))
        assertEquals(NavRoute.Chat.route, searchHitRoute("message"))
    }

    // Routes that carry an id go through android.net.Uri.encode, which plain JVM
    // tests cannot run; a message without a conversation falls back to the list.
    @Test
    fun `a message hit without a conversation opens the chat list`() {
        assertEquals(NavRoute.Chat.route, searchHitRoute("message", "msg_1", conversationId = null))
        assertEquals(NavRoute.Chat.route, searchHitRoute("message", "msg_1", conversationId = ""))
    }

    @Test
    fun `the plural filter value is not a hit type`() {
        // The request filter says "todos"; a hit says "todo". Mixing them up
        // would silently route nowhere.
        assertNull(searchHitRoute("todos"))
        assertNull(searchHitRoute("events"))
        assertNull(searchHitRoute("messages"))
    }

    @Test
    fun `an unknown type leaves navigation alone`() {
        assertNull(searchHitRoute(null))
        assertNull(searchHitRoute(""))
        assertNull(searchHitRoute("artifact"))
    }
}
