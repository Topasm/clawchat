package com.clawchat.android.feature.planner

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.clawchat.android.feature.calendar.CalendarScreen
import com.clawchat.android.feature.today.TodayScreen
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

enum class PlannerPage {
    TODAY,
    WEEK,
    MONTH,
}

internal val PLANNER_PAGE_ORDER = listOf(
    PlannerPage.TODAY,
    PlannerPage.WEEK,
    PlannerPage.MONTH,
)

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun PlannerScreen(
    initialPage: PlannerPage = PlannerPage.TODAY,
    showAgentFeatures: Boolean = true,
    onOpenNavigation: () -> Unit = {},
    onNavigateToInbox: () -> Unit = {},
    onNavigateToReview: () -> Unit = {},
    onNavigateToRuns: () -> Unit = {},
    onNavigateToSearch: () -> Unit = {},
    onPageChanged: (PlannerPage) -> Unit = {},
) {
    val initialIndex = PLANNER_PAGE_ORDER.indexOf(initialPage).coerceAtLeast(0)
    val pagerState = rememberPagerState(
        initialPage = initialIndex,
        pageCount = { PLANNER_PAGE_ORDER.size },
    )
    val scope = rememberCoroutineScope()

    LaunchedEffect(pagerState, initialPage) {
        val requestedPage = PLANNER_PAGE_ORDER.indexOf(initialPage).coerceAtLeast(0)
        if (pagerState.settledPage != requestedPage) {
            pagerState.scrollToPage(requestedPage)
        }
        snapshotFlow { pagerState.settledPage }
            .distinctUntilChanged()
            .collect { page -> onPageChanged(PLANNER_PAGE_ORDER[page]) }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        HorizontalPager(
            state = pagerState,
            modifier = Modifier.fillMaxSize(),
            key = { PLANNER_PAGE_ORDER[it].name },
        ) { page ->
            when (PLANNER_PAGE_ORDER[page]) {
                PlannerPage.TODAY -> TodayScreen(
                    showAgentFeatures = showAgentFeatures,
                    onOpenNavigation = onOpenNavigation,
                    onNavigateToInbox = onNavigateToInbox,
                    onNavigateToReview = onNavigateToReview,
                    onNavigateToRuns = onNavigateToRuns,
                    onNavigateToSearch = onNavigateToSearch,
                )
                PlannerPage.WEEK -> WeekScreen(onOpenNavigation = onOpenNavigation)
                PlannerPage.MONTH -> CalendarScreen(onOpenNavigation = onOpenNavigation)
            }
        }

        PlannerPageSwitcher(
            selectedPage = PLANNER_PAGE_ORDER[pagerState.currentPage],
            onSelect = { target ->
                val targetIndex = PLANNER_PAGE_ORDER.indexOf(target)
                if (targetIndex != pagerState.currentPage) {
                    scope.launch { pagerState.animateScrollToPage(targetIndex) }
                }
            },
            modifier = Modifier
                .align(Alignment.BottomStart)
                .navigationBarsPadding()
                .padding(start = 12.dp, bottom = 16.dp),
        )
    }
}

@Composable
private fun PlannerPageSwitcher(
    selectedPage: PlannerPage,
    onSelect: (PlannerPage) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier.widthIn(max = 276.dp),
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surfaceContainerHigh.copy(alpha = 0.96f),
        shadowElevation = 6.dp,
    ) {
        Row(
            modifier = Modifier.padding(4.dp),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            PLANNER_PAGE_ORDER.forEach { page ->
                val selected = page == selectedPage
                Surface(
                    modifier = Modifier.selectable(
                        selected = selected,
                        role = Role.Tab,
                        onClick = { onSelect(page) },
                    ),
                    shape = MaterialTheme.shapes.medium,
                    color = if (selected) {
                        MaterialTheme.colorScheme.primaryContainer
                    } else {
                        Color.Transparent
                    },
                    contentColor = if (selected) {
                        MaterialTheme.colorScheme.onPrimaryContainer
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                ) {
                    Text(
                        text = stringResource(page.labelResource),
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 7.dp),
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
            }
        }
    }
}

private val PlannerPage.labelResource: Int
    get() = when (this) {
        PlannerPage.TODAY -> R.string.planner_today
        PlannerPage.WEEK -> R.string.planner_week
        PlannerPage.MONTH -> R.string.planner_month
    }
