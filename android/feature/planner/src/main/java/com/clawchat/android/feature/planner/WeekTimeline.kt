package com.clawchat.android.feature.planner

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale

/** Bars past this stay out of the strip; the sections below carry the rest. */
private const val MAX_TIMELINE_ROWS = 5

/**
 * The week as one picture: seven columns, one bar per deadline.
 *
 * The sections below answer "what exactly is due that day". This answers the
 * question a list cannot — how the week's work overlaps and how much room is
 * left before each deadline — using the same span the month grid draws.
 */
@Composable
internal fun WeekTimeline(
    range: WeekRange,
    spans: List<WeekTaskSpan>,
    today: LocalDate,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    val days = (0..6).map { range.start.plusDays(it.toLong()) }

    Column(modifier = modifier.fillMaxWidth()) {
        Row(modifier = Modifier.fillMaxWidth()) {
            days.forEach { day ->
                val isToday = day == today
                Column(
                    modifier = Modifier.weight(1f),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        text = day.dayOfWeek.getDisplayName(TextStyle.NARROW, locale),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        text = day.dayOfMonth.toString(),
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = if (isToday) FontWeight.Bold else FontWeight.Normal,
                        color = if (isToday) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurface
                        },
                        textAlign = TextAlign.Center,
                    )
                }
            }
        }

        spans.take(MAX_TIMELINE_ROWS).forEach { span ->
            Column(modifier = Modifier.padding(top = 8.dp)) {
                Text(
                    text = span.todo.title,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (span.isOverdue) {
                        MaterialTheme.colorScheme.error
                    } else {
                        MaterialTheme.colorScheme.onSurface
                    },
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                WeekSpanBar(span = span, modifier = Modifier.padding(top = 2.dp))
            }
        }

        val hidden = spans.size - MAX_TIMELINE_ROWS
        if (hidden > 0) {
            Text(
                text = pluralStringResource(R.plurals.week_timeline_more, hidden, hidden),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 6.dp),
            )
        }
    }
}

/**
 * One flat line placed across the week by weight, rather than seven cells
 * drawn side by side: a multi-day stretch has no seams to round away.
 */
@Composable
private fun WeekSpanBar(span: WeekTaskSpan, modifier: Modifier = Modifier) {
    val fill = if (span.isOverdue) {
        MaterialTheme.colorScheme.error
    } else {
        MaterialTheme.colorScheme.secondary
    }
    val before = span.startIndex
    val length = span.endIndex - span.startIndex + 1
    val after = 6 - span.endIndex

    Row(modifier = modifier.fillMaxWidth()) {
        if (before > 0) Spacer(Modifier.weight(before.toFloat()))
        Box(
            modifier = Modifier
                .weight(length.toFloat())
                .height(4.dp)
                .background(fill),
        )
        if (after > 0) Spacer(Modifier.weight(after.toFloat()))
    }
}
