package com.clawchat.android.feature.review

import com.clawchat.android.core.data.model.ReviewItem
import com.clawchat.android.core.data.model.ReviewSubjectType

internal fun scopedReviews(items: List<ReviewItem>, reviewId: String?, runId: String?): List<ReviewItem> =
    items.filter {
        when {
            reviewId != null -> it.id == reviewId
            runId != null -> it.subjectType == ReviewSubjectType.AGENT_RUN && it.subjectId == runId
            else -> true
        }
    }
