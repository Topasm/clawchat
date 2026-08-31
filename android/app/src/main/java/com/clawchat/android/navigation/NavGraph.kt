package com.clawchat.android.navigation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import com.clawchat.android.core.ui.icons.ClawIcons
import androidx.compose.material3.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
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
import com.clawchat.android.feature.calendar.CalendarScreen
import com.clawchat.android.feature.search.SearchScreen
import com.clawchat.android.feature.today.TodayScreen
import com.clawchat.android.R
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.repository.SearchType
import kotlinx.coroutines.launch

private data class DrawerNavItem(
    val route: String,
    val icon: ImageVector,
    @StringRes val labelRes: Int,
)

private val allDrawerNavItems = listOf(
    DrawerNavItem(NavRoute.Today.route, ClawIcons.Today, R.string.nav_today),
    DrawerNavItem(NavRoute.Inbox.route, ClawIcons.Inbox, R.string.nav_inbox),
    DrawerNavItem(NavRoute.Tasks.route, ClawIcons.Checklist, R.string.nav_tasks),
    DrawerNavItem(NavRoute.Chat.route, ClawIcons.Chat, R.string.nav_chat),
    DrawerNavItem(NavRoute.Calendar.route, Icons.Default.DateRange, R.string.nav_calendar),
    DrawerNavItem(NavRoute.Review.route, ClawIcons.CheckCircle, R.string.nav_review),
    DrawerNavItem(NavRoute.Runs.route, Icons.Default.PlayArrow, R.string.nav_runs),
    DrawerNavItem(NavRoute.Search.route, Icons.Default.Search, R.string.nav_search),
    DrawerNavItem(NavRoute.Settings.route, Icons.Default.Settings, R.string.nav_settings),
)

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
) {
    val navController = rememberNavController()
    val startDestination = if (workspaceMode == WorkspaceMode.UNCONFIGURED) {
        NavRoute.Onboarding.route
    } else {
        NavRoute.Today.route
    }
    val drawerState = rememberDrawerState(initialValue = DrawerValue.Closed)
    val coroutineScope = rememberCoroutineScope()
    val drawerItemsByRoute = remember { allDrawerNavItems.associateBy(DrawerNavItem::route) }
    val primaryDrawerItems = remember(workspaceMode) {
        NavigationCapabilities.primaryRoutes(workspaceMode).mapNotNull(drawerItemsByRoute::get)
    }
    val secondaryDrawerItems = remember(workspaceMode) {
        NavigationCapabilities.secondaryRoutes(workspaceMode).mapNotNull(drawerItemsByRoute::get)
    }

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
        navController.navigate(route) {
            popUpTo(NavRoute.Today.route)
            launchSingleTop = true
        }
        onDeepLinkHandled()
    }

    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = navBackStackEntry?.destination?.route
    val currentBaseRoute = currentRoute?.substringBefore('?')
    val openNavigation: () -> Unit = {
        coroutineScope.launch { drawerState.open() }
    }
    val navigateFromDrawer: (String) -> Unit = { route ->
        coroutineScope.launch { drawerState.close() }
        if (
            route != currentBaseRoute &&
            NavigationCapabilities.canOpen(workspaceMode, route)
        ) {
            navController.navigate(route) {
                if (route != NavRoute.Review.route && route != NavRoute.Runs.route) {
                    popUpTo(navController.graph.findStartDestination().id) {
                        saveState = true
                    }
                    restoreState = true
                }
                launchSingleTop = true
            }
        }
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        gesturesEnabled = workspaceMode != WorkspaceMode.UNCONFIGURED,
        drawerContent = {
            ClawChatDrawerContent(
                workspaceMode = workspaceMode,
                primaryItems = primaryDrawerItems,
                secondaryItems = secondaryDrawerItems,
                selectedRoute = currentBaseRoute,
                onNavigate = navigateFromDrawer,
            )
        },
    ) {
        NavHost(
            navController = navController,
            startDestination = startDestination,
            modifier = Modifier.fillMaxSize(),
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
                    showAgentFeatures = workspaceMode == WorkspaceMode.SERVER,
                    onOpenNavigation = openNavigation,
                    onNavigateToInbox = {
                        if (NavigationCapabilities.canOpen(workspaceMode, NavRoute.Inbox.route)) {
                            navController.navigate(NavRoute.Inbox.route) {
                                popUpTo(navController.graph.findStartDestination().id) {
                                    saveState = true
                                }
                                launchSingleTop = true
                                restoreState = true
                            }
                        }
                    },
                    onNavigateToReview = {
                        if (NavigationCapabilities.canOpen(workspaceMode, NavRoute.Review.route)) {
                            navController.navigate(NavRoute.Review.route)
                        }
                    },
                    onNavigateToRuns = {
                        if (NavigationCapabilities.canOpen(workspaceMode, NavRoute.Runs.route)) {
                            navController.navigate(NavRoute.Runs.destination())
                        }
                    },
                    onNavigateToSearch = {
                        navController.navigate(NavRoute.Search.route)
                    },
                )
            }
            composable(NavRoute.Search.route) {
                SearchScreen(
                    availableTypes = if (workspaceMode == WorkspaceMode.LOCAL) {
                        listOf(SearchType.Tasks, SearchType.Events)
                    } else {
                        SearchType.entries
                    },
                    onOpenNavigation = openNavigation,
                    onOpenHit = { hit ->
                        searchHitRoute(hit.type)?.let { route ->
                            if (!NavigationCapabilities.canOpen(workspaceMode, route)) return@let
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
                CalendarScreen(onOpenNavigation = openNavigation)
            }
            composable(NavRoute.Inbox.route) {
                ServerOnlyDestination(
                    workspaceMode = workspaceMode,
                    onConnectWorkspace = openConnectionSetup,
                ) {
                    InboxScreen(onOpenNavigation = openNavigation)
                }
            }
            composable(NavRoute.Chat.route) {
                ServerOnlyDestination(
                    workspaceMode = workspaceMode,
                    onConnectWorkspace = openConnectionSetup,
                ) {
                    ChatScreen(onOpenNavigation = openNavigation)
                }
            }
            composable(NavRoute.Tasks.route) {
                TasksScreen(onOpenNavigation = openNavigation)
            }
            composable(NavRoute.Review.route) {
                ServerOnlyDestination(
                    workspaceMode = workspaceMode,
                    onConnectWorkspace = openConnectionSetup,
                ) {
                    ReviewInboxScreen(
                        onBack = { navController.popBackStack() },
                        onOpenNavigation = openNavigation,
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
                        onOpenNavigation = openNavigation,
                        onOpenReview = {
                            navController.navigate(NavRoute.Review.route) { launchSingleTop = true }
                        },
                        initialRunId = entry.arguments?.getString(NavRoute.Runs.ARG_RUN_ID),
                    )
                }
            }
            composable(NavRoute.Settings.route) {
                SettingsScreen(
                    onOpenNavigation = openNavigation,
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
private fun ClawChatDrawerContent(
    workspaceMode: WorkspaceMode,
    primaryItems: List<DrawerNavItem>,
    secondaryItems: List<DrawerNavItem>,
    selectedRoute: String?,
    onNavigate: (String) -> Unit,
) {
    ModalDrawerSheet(
        modifier = Modifier.widthIn(max = 304.dp),
        drawerContainerColor = MaterialTheme.colorScheme.surface,
        drawerTonalElevation = 0.dp,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
        ) {
            Text(
                text = stringResource(R.string.app_name),
                modifier = Modifier.padding(start = 24.dp, top = 24.dp, end = 24.dp),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = stringResource(
                    when (workspaceMode) {
                        WorkspaceMode.LOCAL -> R.string.navigation_local_workspace
                        WorkspaceMode.SERVER -> R.string.navigation_server_workspace
                        WorkspaceMode.UNCONFIGURED -> R.string.navigation_setup_workspace
                    },
                ),
                modifier = Modifier.padding(start = 24.dp, top = 4.dp, end = 24.dp, bottom = 20.dp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            if (primaryItems.isNotEmpty()) {
                DrawerSectionLabel(R.string.navigation_primary_section)
                primaryItems.forEach { item ->
                    ClawChatDrawerItem(
                        item = item,
                        selected = item.route == selectedRoute,
                        onClick = { onNavigate(item.route) },
                    )
                }
            }
            if (secondaryItems.isNotEmpty()) {
                HorizontalDivider(
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                    color = MaterialTheme.colorScheme.outlineVariant,
                )
                DrawerSectionLabel(R.string.navigation_more_section)
                secondaryItems.forEach { item ->
                    ClawChatDrawerItem(
                        item = item,
                        selected = item.route == selectedRoute,
                        onClick = { onNavigate(item.route) },
                    )
                }
            }
        }
    }
}

@Composable
private fun DrawerSectionLabel(@StringRes labelRes: Int) {
    Text(
        text = stringResource(labelRes),
        modifier = Modifier.padding(start = 24.dp, top = 16.dp, end = 24.dp, bottom = 6.dp),
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun ClawChatDrawerItem(
    item: DrawerNavItem,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val label = stringResource(item.labelRes)
    NavigationDrawerItem(
        label = {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            )
        },
        icon = {
            Icon(
                imageVector = item.icon,
                contentDescription = null,
                modifier = Modifier.size(20.dp),
            )
        },
        selected = selected,
        onClick = onClick,
        modifier = Modifier.padding(horizontal = 12.dp, vertical = 1.dp),
        shape = MaterialTheme.shapes.small,
        colors = NavigationDrawerItemDefaults.colors(
            selectedContainerColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.10f),
            unselectedContainerColor = Color.Transparent,
        ),
    )
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
