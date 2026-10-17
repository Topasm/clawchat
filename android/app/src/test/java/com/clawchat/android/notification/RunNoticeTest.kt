package com.clawchat.android.notification

import com.clawchat.android.R
import com.clawchat.android.core.notification.ReminderNotificationHelper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RunNoticeTest {
    private val korean = mapOf(
        R.string.push_run_untitled to "에이전트 실행",
        R.string.push_run_state_running to "실행 중",
        R.string.push_run_state_completed to "완료",
        R.string.push_run_state_input to "답 필요",
        R.string.push_run_state_input_reminder to "아직 답을 기다려요",
        R.string.push_run_state_review to "검토 대기",
        R.string.push_run_state_failed to "실패",
        R.string.push_run_step to "단계 %1\$d/%2\$d",
        R.string.push_run_tap_to_answer to "%1\$s · 눌러서 답하기",
        R.string.push_run_risk_low to "위험 낮음 · 파일 변경 없음",
        R.string.push_run_risk_medium to "위험 보통 · 열어서 확인",
        R.string.push_run_risk_high to "위험 높음 · 열어서 확인",
        R.string.push_run_risk_unknown to "열어서 확인",
    )
    private val strings = RunNoticeStrings { id, args -> korean.getValue(id).format(*args) }

    @Test
    fun `a running run shows its machine, step, bar and elapsed time`() {
        val notice = runNotice(
            mapOf(
                "run_id" to "run_1",
                "status" to "running",
                "title" to "GPU 커널 프로파일링",
                "host_label" to "맥북",
                "step" to "3",
                "step_count" to "4",
                "progress" to "60",
                "started_at_ms" to "1792227600000",
                "push_key" to "running@a",
            ),
            strings,
        )!!

        assertEquals("실행 중", notice.subText)
        assertEquals("GPU 커널 프로파일링", notice.title)
        assertEquals("맥북 · 단계 3/4", notice.text)
        assertEquals(60, notice.progress)
        assertEquals(1792227600000L, notice.startedAtMillis)
        assertTrue(notice.ongoing)
        assertFalse(notice.deduplicate)
    }

    @Test
    fun `a run without progress yet gets a moving bar and no step for a single skill`() {
        val notice = runNotice(
            mapOf("run_id" to "run_1", "status" to "running", "step" to "1", "step_count" to "1"),
            strings,
        )!!

        assertEquals("에이전트 실행", notice.title)
        assertEquals("", notice.text)
        assertEquals(ReminderNotificationHelper.PROGRESS_INDETERMINATE, notice.progress)
        assertNull(notice.startedAtMillis)
    }

    @Test
    fun `a question leads and the reminder says it is still waiting`() {
        val data = mapOf(
            "run_id" to "run_1",
            "status" to "waiting_input",
            "title" to "Gpu 컴퓨팅 과제",
            "detail" to "결과를 어디에 저장할까요?",
            "push_key" to "waiting_input@a",
        )

        val first = runNotice(data, strings)!!
        assertEquals("답 필요", first.subText)
        assertEquals("결과를 어디에 저장할까요?", first.title)
        assertEquals("Gpu 컴퓨팅 과제 · 눌러서 답하기", first.text)
        assertEquals("run:run_1:waiting_input@a", first.deliveryKey)

        val reminder = runNotice(data + mapOf("reminder" to "1", "push_key" to "waiting_input@a:reminder"), strings)!!
        assertEquals("아직 답을 기다려요", reminder.subText)
        assertEquals("run:run_1:waiting_input@a:reminder", reminder.deliveryKey)
    }

    @Test
    fun `a review names its risk and only a low-risk one offers approve`() {
        val base = mapOf(
            "run_id" to "run_1",
            "status" to "waiting_review",
            "title" to "GPU 과목 공지 요약",
            "review_id" to "review_1",
            "detail" to "새 공지 2건",
        )

        val low = runNotice(base + ("risk_level" to "low"), strings)!!
        assertEquals("검토 대기", low.subText)
        assertEquals("위험 낮음 · 파일 변경 없음", low.text)
        assertEquals("위험 낮음 · 파일 변경 없음\n새 공지 2건", low.bigText)
        assertTrue(low.offerApprove)

        val medium = runNotice(base + ("risk_level" to "medium"), strings)!!
        assertEquals("위험 보통 · 열어서 확인", medium.text)
        assertFalse(medium.offerApprove)

        val unknown = runNotice(base - "risk_level", strings)!!
        assertEquals("열어서 확인", unknown.text)
        assertFalse(unknown.offerApprove)

        val noReview = runNotice(base + ("risk_level" to "low") - "review_id", strings)!!
        assertFalse(noReview.offerApprove)
    }

    @Test
    fun `older servers without a push key still deduplicate by status`() {
        val notice = runNotice(
            mapOf("run_id" to "run_1", "status" to "failed", "detail" to "FileNotFoundError"),
            strings,
        )!!

        assertEquals("실패", notice.subText)
        assertEquals("FileNotFoundError", notice.text)
        assertEquals("run:run_1:failed", notice.deliveryKey)
        assertNull(runNotice(mapOf("run_id" to "run_1", "status" to "queued"), strings))
    }
}
