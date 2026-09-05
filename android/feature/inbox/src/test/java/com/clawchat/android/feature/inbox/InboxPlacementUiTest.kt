package com.clawchat.android.feature.inbox

import com.clawchat.android.core.data.model.ProjectNode
import com.clawchat.android.core.data.model.ProjectPlan
import org.junit.Assert.*
import org.junit.Test
import java.util.Locale

class InboxPlacementUiTest {
    private fun node(id: String, parent: String?) = ProjectNode(id, id, parent, "task", "pending")

    @Test fun `parent options start at root task and exclude other projects and own subtree`() {
        val options = inboxParentOptions(ProjectPlan("project", "Paper", rootTaskId = "root"), listOf(
            node("chapter", "root"), node("t", "chapter"), node("child", "t"),
            node("other", "other-root"), node("wrong", "project"),
        ), "t")
        assertEquals(listOf("root", "chapter"), options.map { it.id })
        assertEquals("Paper › chapter", options.last().path)
    }

    @Test fun `malformed cycles terminate without duplicate options`() {
        val options = inboxParentOptions(ProjectPlan("p", "P", rootTaskId = "root"),
            listOf(node("root", "branch"), node("branch", "root")), "t")
        assertEquals(listOf("root", "branch"), options.map { it.id })
    }

    @Test fun `missing root does not expose unrelated tasks`() {
        assertTrue(inboxParentOptions(ProjectPlan("p", "P"), listOf(node("x", null)), "t").isEmpty())
    }

    @Test fun `dates are readable without changing the stored calendar day`() {
        assertEquals("Sep 11, 2026", inboxDisplayDate("2026-09-11T23:59:59", Locale.US))
        assertEquals("2026. 9. 11.", inboxDisplayDate("2026-09-11", Locale.KOREA))
        assertEquals("invalid", inboxDisplayDate("invalid", Locale.US))
    }
}
