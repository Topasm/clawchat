package com.clawchat.android.navigation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.WindowInsets
import com.clawchat.android.core.ui.icons.ClawIcons
import androidx.compose.material3.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.annotation.StringRes
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.clawchat.android.feature.chat.ChatScreen
import com.clawchat.android.feature.inbox.InboxScreen
import com.clawchat.android.feature.onboarding.OnboardingScreen
import com.clawchat.android.feature.review.ReviewInboxScreen
import com.clawchat.android.feature.runs.AgentRunsScreen
import com.clawchat.android.feature.settings.SettingsScreen
import com.clawchat.android.feature.tasks.TasksScreen
import com.clawchat.android.feature.planner.PlannerPage
import com.clawchat.android.feature.planner.PlannerScreen
import com.clawchat.android.feature.progress.ProgressScreen
import com.clawchat.android.feature.search.SearchScreen
import com.clawchat.android.feature.search.QuickFindDestination
import com.clawchat.android.R
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.repository.SearchType

private data class BottomNavItem(
    val route: String,
    val icon: ImageVector,
    @StringRes val labelRes: Int,
)

private val allBottomNavItems = listOf(
    BottomNavItem(NavRoute.Progress.route, Icons.Default.PlayArrow, R.string.nav_progress),
    BottomNavItem(NavRoute.Tasks.route, ClawIcons.Checklist, R.string.nav_tasks),
    BottomNavItem(NavRoute.Today.route, Icons.Default.DateRange, R.string.nav_schedule),
    BottomNavItem(NavRoute.Chat.route, ClawIcons.Chat, R.string.nav_chat),
)

internal fun plannerPrimaryRoute(currentRoute: String?): String? =
    when (currentRoute) {
        NavRoute.Today.route, NavRoute.Calendar.route -> NavRoute.Today.route
        else -> currentRoute
    }

/**
 * Whether [targetRoute] is the tab that also serves as the graph's start
 * destination (Progress in server mode, Tasks in local mode). That entry
 * sits underneath every other tab's `popUpTo`, so it never actually gets
 * popped by the normal save/restore dance — navigating back to it with the
 * usual `saveState`/`restoreState` pair can then silently no-op instead of
 * restoring it. [startDestinationRoute] is compared with its query pattern
 * stripped, since a start destination with an optional argument (like Tasks)
 * registers its route as `tasks?todo_id={todo_id}`, not the bare `tasks` a
 * bottom-nav tap targets.
 */
internal fun isStartDestinationTarget(targetRoute: String, startDestinationRoute: String?): Boolean =
    targetRoute == startDestinationRoute?.substringBefore('?')

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClawChatNavGraph(
    isLoggedIn: Boolean,
    onboardingSkipped: Boolean = false,
    workspaceMode: WorkspaceMode = when {
        isLoggedIn -> WorkspaceMode.SERVER
        onboardingSkipped -> WorkspaceMode.LOCAL
        else -> WorkspaceMode.UNCONFIGURED
    },
    /** Destination a tapped notification asked for, or null. */
    deepLinkRoute: String? = null,
    onDeepLinkHandled: () -> Unit = {},
    attentionCount: Int = 0,
) {
    val navController = rememberNavController()
    val startDestination = NavigationCapabilities.startRoute(workspaceMode)
    val bottomItemsByRoute = remember { allBottomNavItems.associateBy(BottomNavItem::route) }
    val primaryBottomItems = remember(workspaceMode) {
        NavigationCapabilities.primaryRoutes(workspaceMode).mapNotNull(bottomItemsByRoute::get)
    }
    var plannerPage by rememberSaveable { mutableStateOf(PlannerPage.TODAY) }

    val openConnectionSetup = {
        navController.navigate(NavRoute.Onboarding.route) { launchSingleTop = true }
    }

    // Onboarding owns the screen until there is a session, so a reminder that
    // arrives before then is dropped rather than queued behind the setup flow.
    LaunchedEffect(deepLinkRoute, workspaceMode) {
        val route = deepLinkRoute ?: return@LaunchedEffect
        if (!NavigationCapabilities.canOpen(workspaceMode, route)) {
            onDeepLinkHandled()
            return@LaunchedEffect
        }
        when (route.substringBefore('?')) {
            NavRoute.Today.route -> plannerPage = PlannerPage.TODAY
            NavRoute.Calendar.route -> plannerPage = PlannerPage.MONTH
            else -> Unit
        }
        navController.navigate(route) {
            popUpTo(navController.graph.findStartDestination().id)
            launchSingleTop = true
        }
        onDeepLinkHandled()
    }

    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = navBackStackEntry?.destination?.route
    val currentBaseRoute = currentRoute?.substringBefore('?')
    val selectedPrimaryRoute = plannerPrimaryRoute(currentBaseRoute)
    val showBottomNavigation = currentBaseRoute != null &&
        currentBaseRoute != NavRoute.Onboarding.route &&
        currentBaseRoute !in setOf(NavRoute.Inbox.route, NavRoute.Review.route, NavRoute.Runs.route)
    val navigateToPrimary: (String) -> Unit = { route ->
        when (route) {
            NavRoute.Today.route -> plannerPage = PlannerPage.TODAY
            NavRoute.Calendar.route -> plannerPage = PlannerPage.MONTH
            else -> Unit
        }
        if (
            route != currentBaseRoute &&
            NavigationCapabilities.canOpen(workspaceMode, route)
        ) {
            val targetIsStartDestination = isStartDestinationTarget(
                route,
                navController.graph.findStartDestination().route,
            )
            navController.navigate(route) {
                popUpTo(navController.graph.findStartDestination().id) {
                    saveState = !targetIsStartDestination
                    inclusive = targetIsStartDestination
                }
                restoreState = !targetIsStartDestination
                launchSingleTop = true
            }
        }
    }
    val navigateToNow: () -> Unit = {
        navigateToPrimary(NavRoute.Progress.route)
    }
    val navigateToReview: (String?) -> Unit = { reviewId ->
        if (NavigationCapabilities.canOpen(workspaceMode, NavRoute.Review.route)) {
            navController.navigate(NavRoute.Review.destination(reviewId))
        }
    }
    val navigateToRuns: () -> Unit = {
        if (NavigationCapabilities.canOpen(workspaceMode, NavRoute.Runs.route)) {
            navController.navigate(NavRoute.Runs.destination())
        }
    }
    val navigateToSearch: () -> Unit = {
        navController.navigate(NavRoute.Search.route)
    }
    val navigateToSettings: () -> Unit = {
        navController.navigate(NavRoute.Settings.route) { launchSingleTop = true }
    }

    Scaffold(
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        bottomBar = {
            if (showBottomNavigation && primaryBottomItems.isNotEmpty()) {
                NavigationBar {
                    primaryBottomItems.forEach { item ->
                        NavigationBarItem(
                            selected = item.route == selectedPrimaryRoute,
                            onClick = { navigateToPrimary(item.route) },
                            icon = {
                                if (item.route == NavRoute.Progress.route && attentionCount > 0) {
                                    BadgedBox(
                                        badge = {
                                            Badge {
                                                Text(attentionCount.coerceAtMost(99).toString())
                                            }
                                        },
                                    ) {
                                        Icon(item.icon, contentDescription = null)
                                    }
                                } else {
                                    Icon(item.icon, contentDescription = null)
                                }
                            },
                            label = { Text(stringResource(item.labelRes)) },
                        )
                    }
                }
            }
        },
    ) { rootPadding ->
        NavHost(
            navController = navController,
            startDestination = startDestination,
            modifier = Modifier
                .fillMaxSize()
                .padding(rootPadding)
                .consumeWindowInsets(rootPadding),
        ) {
            composable(NavRoute.Onboarding.route) {
                OnboardingScreen(
                    onComplete = {
                        navController.navigate(NavRoute.Progress.route) {
                            popUpTo(NavRoute.Onboarding.route) { inclusive = true }
                        }
                    },
                    onSkip = {
                        navController.navigate(NavRoute.Tasks.route) {
                            popUpTo(NavRoute.Onboarding.route) { inclusive = true }
                        }
                    },
                )
            }
            composable(NavRoute.Today.route) {
                PlannerScreen(
                    initialPage = plannerPage,
                    showAgentFeatures = workspaceMode == WorkspaceMode.SERVER,
                    onNavigateToInbox = navigateToNow,
                    onNavigateToReview = { navigateToReview(null) },
                    onNavigateToRuns = navigateToRuns,
                    onNavigateToSearch = navigateToSearch,
                    onNavigateToSettings = navigateToSettings,
                    onOpenTask = { todoId ->
                        navController.navigate(NavRoute.Tasks.destination(todoId)) {
                            launchSingleTop = true
                        }
                    },
                    onPageChanged = { plannerPage = it },
                )
            }
            composable(NavRoute.Search.route) {
                SearchScreen(
                    availableTypes = if (workspaceMode == WorkspaceMode.LOCAL) {
                        listOf(SearchType.Tasks, SearchType.Events)
                    } else {
                        SearchType.entries
                    },
                    onBack = { navController.popBackStack() },
                    quickDestinations = if (workspaceMode == WorkspaceMode.LOCAL) {
                        listOf(
                            QuickFindDestination.IN_PROGRESS,
                            QuickFindDestination.SCHEDULE,
                            QuickFindDestination.SETTINGS,
                        )
                    } else {
                        QuickFindDestination.entries
                    },
                    onOpenDestination = { destination ->
                        val route = when (destination) {
                            QuickFindDestination.NOW -> NavRoute.Progress.route
                            QuickFindDestination.IN_PROGRESS -> NavRoute.Tasks.route
                            QuickFindDestination.SCHEDULE -> NavRoute.Today.route
                            QuickFindDestination.CHAT -> NavRoute.Chat.route
                            QuickFindDestination.SETTINGS -> NavRoute.Settings.route
                        }
                        if (NavigationCapabilities.canOpen(workspaceMode, route)) {
                            navController.navigate(route) {
                                popUpTo(navController.graph.findStartDestination().id) {
                                    saveState = true
                                }
                                launchSingleTop = true
                                restoreState = true
                            }
                        }
                    },
                    onOpenHit = { hit ->
                        searchHitRoute(hit.type, hit.id)?.let { route ->
                            if (!NavigationCapabilities.canOpen(workspaceMode, route)) return@let
                            if (route == NavRoute.Calendar.route) plannerPage = PlannerPage.MONTH
                            navController.navigate(route) {
                                popUpTo(navController.graph.findStartDestination().id) {
                                    saveState = true
                                }
                                launchSingleTop = true
                                restoreState = true
                            }
                        }
                    },
                )
            }
            composable(NavRoute.Calendar.route) {
                PlannerScreen(
                    initialPage = plannerPage,
                    showAgentFeatures = workspaceMode == WorkspaceMode.SERVER,
                    onNavigateToInbox = navigateToNow,
                    onNavigateToReview = { navigateToReview(null) },
                    onNavigateToRuns = navigateToRuns,
                    onNavigateToSearch = navigateToSearch,
                    onNavigateToSettings = navigateToSettings,
                    onOpenTask = { todoId ->
                        navController.navigate(NavRoute.Tasks.destination(todoId)) {
                            launchSingleTop = true
                        }
                    },
                    onPageChanged = { plannerPage = it },
                )
            }
            composable(NavRoute.Inbox.route) {
                ServerOnlyDestination(
                    workspaceMode = workspaceMode,
                    onConnectWorkspace = openConnectionSetup,
                ) {
                    InboxScreen(onBack = { navController.popBackStack() })
                }
            }
            composable(NavRoute.Chat.route) {
                ServerOnlyDestination(
                    workspaceMode = workspaceMode,
                    onConnectWorkspace = openConnectionSetup,
                ) {
                    ChatScreen(
                        onOpenSearch = navigateToSearch,
                        onOpenSettings = navigateToSettings,
                    )
                }
            }
            composable(NavRoute.Progress.route) {
                ServerOnlyDestination(
                    workspaceMode = workspaceMode,
                    onConnectWorkspace = openConnectionSetup,
                ) {
                    ProgressScreen(
                        onOpenSearch = navigateToSearch,
                        onOpenSettings = navigateToSettings,
                        onOpenReview = { reviewId -> navigateToReview(reviewId) },
                        onOpenRun = { runId ->
                            navController.navigate(NavRoute.Runs.destination(runId)) {
                                launchSingleTop = true
                            }
                        },
                        onOpenTask = { todoId ->
                            navController.navigate(NavRoute.Tasks.destination(todoId)) {
                                launchSingleTop = true
                            }
                        },
                    )
                }
            }
            composable(
                route = NavRoute.Tasks.routePattern,
                arguments = listOf(
                    navArgument(NavRoute.Tasks.ARG_TODO_ID) {
                        type = NavType.StringType
                        nullable = true
                        defaultValue = null
                    },
                ),
            ) { entry ->
                TasksScreen(
                    onOpenSearch = navigateToSearch,
                    onOpenSettings = navigateToSettings,
                    initialTodoId = entry.arguments?.getString(NavRoute.Tasks.ARG_TODO_ID),
                )
            }
            composable(
                route = NavRoute.Review.routePattern,
                arguments = listOf(
                    navArgument(NavRoute.Review.ARG_REVIEW_ID) {
                        type = NavType.StringType
                        nullable = true
                        defaultValue = null
                    },
                ),
            ) { entry ->
                ServerOnlyDestination(
                    workspaceMode = workspaceMode,
                    onConnectWorkspace = openConnectionSetup,
                ) {
                    ReviewInboxScreen(
                        onBack = { navController.popBackStack() },
                        initialReviewId = entry.arguments?.getString(NavRoute.Review.ARG_REVIEW_ID),
                        onOpenSubject = { review ->
                            val destination = when (review.subjectType) {
                                com.clawchat.android.core.data.model.ReviewSubjectType.AGENT_RUN ->
                                    NavRoute.Runs.destination(review.subjectId)
                                com.clawchat.android.core.data.model.ReviewSubjectType.PLAN_PROPOSAL -> NavRoute.Inbox.route
                                else -> NavRoute.Tasks.route
                            }
                            navController.navigate(destination) { launchSingleTop = true }
                        },
                        onOpenRun = { runId ->
                            navController.navigate(NavRoute.Runs.destination(runId)) {
                                launchSingleTop = true
                            }
                        },
                    )
                }
            }
            composable(
                route = NavRoute.Runs.routePattern,
                arguments = listOf(
                    navArgument(NavRoute.Runs.ARG_RUN_ID) {
                        type = NavType.StringType
                        nullable = true
                        defaultValue = null
                    },
                ),
            ) { entry ->
                ServerOnlyDestination(
                    workspaceMode = workspaceMode,
                    onConnectWorkspace = openConnectionSetup,
                ) {
                    AgentRunsScreen(
                        onBack = { navController.popBackStack() },
                        onOpenReview = {
                            navController.navigate(NavRoute.Review.destination()) { launchSingleTop = true }
                        },
                        initialRunId = entry.arguments?.getString(NavRoute.Runs.ARG_RUN_ID),
                    )
                }
            }
            composable(NavRoute.Settings.route) {
                SettingsScreen(
                    onBack = { navController.popBackStack() },
                    onLoggedOut = {
                        navController.navigate(NavRoute.Onboarding.route) {
                            popUpTo(0) { inclusive = true }
                        }
                    },
                    onSetupServer = openConnectionSetup,
                )
            }
        }
    }
}

@Composable
private fun ServerOnlyDestination(
    workspaceMode: WorkspaceMode,
    onConnectWorkspace: () -> Unit,
    content: @Composable () -> Unit,
) {
    if (workspaceMode == WorkspaceMode.SERVER) {
        content()
        return
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 28.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            imageVector = ClawIcons.Cloud,
            contentDescription = null,
            modifier = Modifier.size(32.dp),
            tint = MaterialTheme.colorScheme.primary,
        )
        Text(
            text = stringResource(R.string.server_feature_requires_workspace_title),
            modifier = Modifier.padding(top = 16.dp),
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = stringResource(R.string.server_feature_requires_workspace_description),
            modifier = Modifier.padding(top = 8.dp),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Button(
            onClick = onConnectWorkspace,
            modifier = Modifier.padding(top = 20.dp),
        ) {
            Text(stringResource(R.string.server_feature_connect_action))
        }
    }
}
