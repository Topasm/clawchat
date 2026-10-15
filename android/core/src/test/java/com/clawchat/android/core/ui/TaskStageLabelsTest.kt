package com.clawchat.android.core.ui

import com.clawchat.android.core.R
import com.clawchat.android.core.data.model.TaskStage
import com.clawchat.android.core.data.model.TaskStageException
import com.clawchat.android.core.data.model.TaskStageState
import org.junit.Assert.assertEquals
import org.junit.Test

class TaskStageLabelsTest {
    @Test
    fun `names the exception before the step`() {
        assertEquals(
            R.string.task_stage_needs_input,
            TaskStageState(TaskStage.RUN, TaskStageException.NEEDS_INPUT).describeRes(),
        )
        assertEquals(R.string.task_stage_review, TaskStageState(TaskStage.REVIEW).describeRes())
        assertEquals(R.string.task_stage_cancelled, TaskStageState(TaskStage.DONE, cancelled = true).describeRes())
    }
}
