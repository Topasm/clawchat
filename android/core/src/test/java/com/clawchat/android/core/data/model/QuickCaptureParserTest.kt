package com.clawchat.android.core.data.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class QuickCaptureParserTest {
    @Test
    fun `plain text stays an unscheduled inbox title`() {
        val draft = QuickCaptureParser.parse("  금요일 보고서 확인  ")!!

        assertEquals("금요일 보고서 확인", draft.title)
        assertEquals("medium", draft.priority)
        assertEquals(emptyList<String>(), draft.tags)
        assertNull(draft.toTodoCreate("android_app", "key").dueDate)
    }

    @Test
    fun `explicit tags and priority are removed from title`() {
        val draft = QuickCaptureParser.parse("보고서 확인 #업무 !높음 #Work #업무")!!

        assertEquals("보고서 확인", draft.title)
        assertEquals("high", draft.priority)
        assertEquals(listOf("업무", "Work"), draft.tags)
    }

    @Test
    fun `ordinary punctuation is not interpreted`() {
        val draft = QuickCaptureParser.parse("Important! #not/a/tag")!!

        assertEquals("Important! #not/a/tag", draft.title)
        assertEquals(emptyList<String>(), draft.tags)
    }

    @Test
    fun `metadata without a title is rejected`() {
        assertNull(QuickCaptureParser.parse("#업무 !high"))
        assertNull(QuickCaptureParser.parse("   "))
    }
}
