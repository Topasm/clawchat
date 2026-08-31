package com.clawchat.android.navigation

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import com.clawchat.android.core.ui.icons.ClawIcons
import androidx.compose.material3.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
import com.clawchat.android.feature.calendar.CalendarScreen
import com.clawchat.android.feature.search.SearchScreen
import com.clawchat.android.feature.today.TodayScreen

data class BottomNavItem(
    val route: String,
    val icon: ImageVector,
    val label: String,
)

val bottomNavItems = listOf(
    BottomNavItem(NavRoute.Today.route, ClawIcons.Today, "Today"),
    BottomNavItem(NavRoute.Calendar.route, Icons.Default.DateRange, "Calendar"),
    BottomNavItem(NavRoute.Inbox.route, ClawIcons.Inbox, "Inbox"),
    BottomNavItem(NavRoute.Chat.route, ClawIcons.Chat, "Chat"),
    BottomNavItem(NavRoute.Tasks.route, ClawIcons.Checklist, "Tasks"),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClawChatNavGraph(
    isLoggedIn: Boolean,
    onboardingSkipped: Boolean = false,
    /** Destination a tapped notification asked for, or null. */
    deepLinkRoute: String? = null,
    onDeepLinkHandled: () -> Unit = {},
) {
    val navController = rememberNavController()
    val startDestination = if (isLoggedIn || onboardingSkipped) NavRoute.Today.route else NavRoute.Onboarding.route

    // Onboarding owns the screen until there is a session, so a reminder that
    // arrives before then is dropped rather than queued behind the setup flow.
    LaunchedEffect(deepLinkRoute, isLoggedIn, onboardingSkipped) {
        val route = deepLinkRoute ?: return@LaunchedEffect
        if (!isLoggedIn && !onboardingSkipped) return@LaunchedEffect
        navController.navigate(route) {
            popUpTo(NavRoute.Today.route)
            launchSingleTop = true
        }
        onDeepLinkHandled()
    }

    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = navBackStackEntry?.destination?.route
    val showBottomBar = currentRoute in bottomNavItems.map { it.route }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        bottomBar = {
            if (showBottomBar) {
                Surface(
                    color = MaterialTheme.colorScheme.background,
                    tonalElevation = 0.dp,
                    shadowElevation = 0.dp,
                ) {
                    Column {
                        HorizontalDivider(
                            thickness = 1.dp,
                            color = MaterialTheme.colorScheme.outlineVariant,
                        )
                        NavigationBar(
                            containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.98f),
                            tonalElevation = 0.dp,
                            modifier = Modifier
                                .fillMaxWidth()
                                .navigationBarsPadding()
                                .height(59.dp),
                            windowInsets = WindowInsets(0, 0, 0, 0),
                        ) {
                            bottomNavItems.forEach { item ->
                                val selected = currentRoute == item.route
                                NavigationBarItem(
                                    icon = {
                                        Icon(
                                            item.icon,
                                            contentDescription = item.label,
                                            modifier = Modifier.size(20.dp),
                                        )
                                    },
                                    label = {
                                        Text(
                                            item.label,
                                            fontSize = 11.sp,
                                            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                                            lineHeight = 11.sp,
                                        )
                                    },
                                    selected = selected,
                                    onClick = {
                                        navController.navigate(item.route) {
                                            popUpTo(navController.graph.findStartDestination().id) {
                                                saveState = true
                                            }
                                            launchSingleTop = true
                                            restoreState = true
                                        }
                                    },
                                    colors = NavigationBarItemDefaults.colors(
                                        selectedIconColor = MaterialTheme.colorScheme.primary,
                                        selectedTextColor = MaterialTheme.colorScheme.primary,
                                        unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                                        unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                                        indicatorColor = Color.Transparent,
                                    ),
                                )
                            }
                        }
                    }
                }
            }
        },
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = startDestination,
            modifier = Modifier
                .padding(innerPadding)
                .consumeWindowInsets(innerPadding),
        ) {
            composable(NavRoute.Onboarding.route) {
                OnboardingScreen(
                    onComplete = {
                        navController.navigate(NavRoute.Today.route) {
                            popUpTo(NavRoute.Onboarding.route) { inclusive = true }
                        }
                    },
                    onSkip = {
                        navController.navigate(NavRoute.Today.route) {
                            popUpTo(NavRoute.Onboarding.route) { inclusive = true }
                        }
                    },
                )
            }
            composable(NavRoute.Today.route) {
                TodayScreen(
                    onNavigateToInbox = {
                        navController.navigate(NavRoute.Inbox.route) {
                            popUpTo(navController.graph.findStartDestination().id) {
                                saveState = true
                            }
                            launchSingleTop = true
                            restoreState = true
                        }
                    },
                    onNavigateToReview = {
                        navController.navigate(NavRoute.Review.route)
                    },
                    onNavigateToRuns = {
                        navController.navigate(NavRoute.Runs.destination())
                    },
                    onNavigateToSearch = {
                        navController.navigate(NavRoute.Search.route)
                    },
                    onNavigateToSettings = {
                        navController.navigate(NavRoute.Settings.route)
                    },
                )
            }
            composable(NavRoute.Search.route) {
                SearchScreen(
                    onBack = { navController.popBackStack() },
                    onOpenHit = { hit ->
                        searchHitRoute(hit.type)?.let { route ->
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
                CalendarScreen()
            }
            composable(NavRoute.Inbox.route) {
                InboxScreen()
            }
            composable(NavRoute.Chat.route) {
                ChatScreen()
            }
            composable(NavRoute.Tasks.route) {
                TasksScreen()
            }
            composable(NavRoute.Review.route) {
                ReviewInboxScreen(
                    onBack = { navController.popBackStack() },
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
                AgentRunsScreen(
                    onBack = { navController.popBackStack() },
                    onOpenReview = {
                        navController.navigate(NavRoute.Review.route) { launchSingleTop = true }
                    },
                    initialRunId = entry.arguments?.getString(NavRoute.Runs.ARG_RUN_ID),
                )
            }
            composable(NavRoute.Settings.route) {
                SettingsScreen(
                    onBack = { navController.popBackStack() },
                    onLoggedOut = {
                        navController.navigate(NavRoute.Onboarding.route) {
                            popUpTo(0) { inclusive = true }
                        }
                    },
                    onSetupServer = {
                        navController.navigate(NavRoute.Onboarding.route) {
                            popUpTo(0) { inclusive = true }
                        }
                    },
                )
            }
        }
    }
}
