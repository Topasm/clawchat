package com.clawchat.android.navigation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.clawchat.android.R
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.model.ReviewSubjectType
import com.clawchat.android.core.data.repository.SearchType
import com.clawchat.android.core.notification.PushStatus
import com.clawchat.android.core.ui.ClawFab
import com.clawchat.android.core.ui.ClawMotion
import com.clawchat.android.core.ui.LocalNavigateHome
import com.clawchat.android.core.ui.LocalPrimaryActionHost
import com.clawchat.android.core.ui.PrimaryActionHost
import com.clawchat.android.core.ui.icons.ClawIcons
import com.clawchat.android.feature.chat.ChatScreen
import com.clawchat.android.feature.devices.DevicesScreen
import com.clawchat.android.feature.home.HomeScreen
import com.clawchat.android.feature.inbox.InboxScreen
import com.clawchat.android.feature.onboarding.OnboardingScreen
import com.clawchat.android.feature.planner.PlannerPage
import com.clawchat.android.feature.planner.PlannerScreen
import com.clawchat.android.feature.progress.ProgressScreen
import com.clawchat.android.feature.review.ReviewInboxScreen
import com.clawchat.android.feature.runs.AgentRunsScreen
import com.clawchat.android.feature.search.SearchScreen
import com.clawchat.android.feature.settings.SettingsScreen
import com.clawchat.android.feature.tasks.ProjectPlanScreen
import com.clawchat.android.feature.tasks.TasksScreen

/**
 * The home list is the start destination of a configured workspace and every
 * other screen is pushed on top of it, so Android's Back returns to Home and
 * the "‹ Home" button in a top bar pops straight to it.
 */
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
    pushStatus: PushStatus = PushStatus.NOT_CONFIGURED,
) {
    val navController = rememberNavController()
    val startDestination = NavigationCapabilities.startRoute(workspaceMode)
    val primaryActions = remember { PrimaryActionHost() }
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

    /** Home is normally underneath; after a deep link that popped it, push it fresh. */
    val navigateHome: () -> Unit = {
        if (!navController.popBackStack(NavRoute.Home.route, inclusive = false)) {
            navController.navigate(NavRoute.Home.route) { launchSingleTop = true }
        }
    }
    val open: (String) -> Unit = { route ->
        if (NavigationCapabilities.canOpen(workspaceMode, route)) {
            navController.navigate(route) { launchSingleTop = true }
        }
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
    val openTask: (String) -> Unit = { todoId ->
        navController.navigate(NavRoute.Tasks.destination(todoId)) { launchSingleTop = true }
    }
    val openRun: (String) -> Unit = { runId ->
        // Review and Runs link to each other; keep one of each on the stack.
        navController.navigate(NavRoute.Runs.destination(runId)) {
            launchSingleTop = true
            popUpTo(NavRoute.Runs.routePattern) { inclusive = true }
        }
    }

    CompositionLocalProvider(
        LocalNavigateHome provides navigateHome,
        LocalPrimaryActionHost provides primaryActions,
    ) {
    Scaffold(
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        floatingActionButton = {
            // The one + button: whichever list is showing says what it adds.
            primaryActions.action?.let { action ->
                ClawFab(
                    onClick = action.onClick,
                    contentDescription = action.contentDescription,
                    modifier = Modifier.navigationBarsPadding(),
                )
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
            enterTransition = { ClawMotion.navEnter() },
            exitTransition = { ClawMotion.navExit() },
            popEnterTransition = { ClawMotion.navPopEnter() },
            popExitTransition = { ClawMotion.navPopExit() },
        ) {
            composable(NavRoute.Onboarding.route) {
                val toHome = {
                    navController.navigate(NavRoute.Home.route) {
                        popUpTo(NavRoute.Onboarding.route) { inclusive = true }
                        launchSingleTop = true
                    }
                }
                OnboardingScreen(onComplete = toHome, onSkip = toHome)
            }
            composable(NavRoute.Home.route) {
                HomeScreen(
                    showServerFeatures = workspaceMode == WorkspaceMode.SERVER,
                    isLocalOnly = workspaceMode == WorkspaceMode.LOCAL,
                    onOpenInbox = { open(NavRoute.Inbox.route) },
                    onOpenToday = {
                        plannerPage = PlannerPage.TODAY
                        open(NavRoute.Today.route)
                    },
                    onOpenSchedule = {
                        plannerPage = PlannerPage.MONTH
                        open(NavRoute.Calendar.route)
                    },
                    onOpenTasks = { open(NavRoute.Tasks.route) },
                    onOpenProgress = { open(NavRoute.Progress.route) },
                    onOpenProject = { projectId -> open(NavRoute.Projects.forProject(projectId)) },
                    onOpenAllProjects = { open(NavRoute.Projects.route) },
                    onOpenChat = { open(NavRoute.Chat.route) },
                    onOpenSettings = { open(NavRoute.Settings.route) },
                    onOpenSearch = navigateToSearch,
                )
            }
            composable(NavRoute.Today.route) {
                PlannerScreen(
                    initialPage = plannerPage,
                    showAgentFeatures = workspaceMode == WorkspaceMode.SERVER,
                    onNavigateToReview = { navigateToReview(null) },
                    onNavigateToRuns = navigateToRuns,
                    onNavigateToSearch = navigateToSearch,
                    onOpenTask = openTask,
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
                    onOpenHit = { hit ->
                        searchHitRoute(hit.type, hit.id, hit.conversationId)?.let { route ->
                            if (!NavigationCapabilities.canOpen(workspaceMode, route)) return@let
                            if (route == NavRoute.Calendar.route) plannerPage = PlannerPage.MONTH
                            // Pushed on top of Search, so Back returns to the results.
                            navController.navigate(route) { launchSingleTop = true }
                        }
                    },
                )
            }
            composable(NavRoute.Calendar.route) {
                PlannerScreen(
                    initialPage = plannerPage,
                    showAgentFeatures = workspaceMode == WorkspaceMode.SERVER,
                    onNavigateToReview = { navigateToReview(null) },
                    onNavigateToRuns = navigateToRuns,
                    onNavigateToSearch = navigateToSearch,
                    onOpenTask = openTask,
                    onPageChanged = { plannerPage = it },
                )
            }
            composable(NavRoute.Inbox.route) {
                ServerOnlyDestination(
                    workspaceMode = workspaceMode,
                    onConnectWorkspace = openConnectionSetup,
                ) {
                    InboxScreen(
                        onBack = { navController.popBackStack() },
                        onTaskClick = { navController.navigate(NavRoute.Tasks.destination(it)) },
                    )
                }
            }
            composable(
                route = NavRoute.Chat.routePattern,
                arguments = listOf(
                    navArgument(NavRoute.Chat.ARG_CONVERSATION_ID) {
                        type = NavType.StringType
                        nullable = true
                        defaultValue = null
                    },
                    navArgument(NavRoute.Chat.ARG_TITLE) { type = NavType.StringType; nullable = true; defaultValue = null },
                    navArgument(NavRoute.Chat.ARG_PROJECT_PLAN) { type = NavType.BoolType; defaultValue = false },
                ),
            ) { entry ->
                ServerOnlyDestination(
                    workspaceMode = workspaceMode,
                    onConnectWorkspace = openConnectionSetup,
                ) {
                    ChatScreen(
                        showProjectPlanReturn = entry.arguments?.getBoolean(NavRoute.Chat.ARG_PROJECT_PLAN) == true,
                        contextTitle = entry.arguments?.getString(NavRoute.Chat.ARG_TITLE),
                        onReturnToSource = { if (!navController.popBackStack()) navController.navigate(NavRoute.Tasks.route) },
                        onOpenSearch = navigateToSearch,
                        initialConversationId = entry.arguments?.getString(
                            NavRoute.Chat.ARG_CONVERSATION_ID,
                        ),
                    )
                }
            }
            composable(NavRoute.Devices.route) {
                ServerOnlyDestination(
                    workspaceMode = workspaceMode,
                    onConnectWorkspace = openConnectionSetup,
                ) {
                    DevicesScreen(onBack = { navController.popBackStack() })
                }
            }
            composable(NavRoute.Progress.route) {
                ServerOnlyDestination(
                    workspaceMode = workspaceMode,
                    onConnectWorkspace = openConnectionSetup,
                ) {
                    ProgressScreen(
                        onOpenSearch = navigateToSearch,
                        onOpenReview = { reviewId -> navigateToReview(reviewId) },
                        onOpenRun = openRun,
                        onOpenTask = openTask,
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
                    allowTaskNotes = workspaceMode == WorkspaceMode.SERVER,
                    onOpenProjects = if (workspaceMode == WorkspaceMode.SERVER) {
                        { navController.navigate(NavRoute.Projects.route) { launchSingleTop = true } }
                    } else null,
                    onOpenSearch = navigateToSearch,
                    initialTodoId = entry.arguments?.getString(NavRoute.Tasks.ARG_TODO_ID),
                    onOpenConversation = { conversationId ->
                        if (NavigationCapabilities.canOpen(workspaceMode, NavRoute.Chat.route)) {
                            navController.navigate(NavRoute.Chat.destination(conversationId)) {
                                launchSingleTop = true
                            }
                        }
                    },
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
                    navArgument(NavRoute.Review.ARG_RUN_ID) { type = NavType.StringType; nullable = true; defaultValue = null },
                ),
            ) { entry ->
                ServerOnlyDestination(
                    workspaceMode = workspaceMode,
                    onConnectWorkspace = openConnectionSetup,
                ) {
                    ReviewInboxScreen(
                        initialRunId = entry.arguments?.getString(NavRoute.Review.ARG_RUN_ID),
                        onBack = { navController.popBackStack() },
                        initialReviewId = entry.arguments?.getString(NavRoute.Review.ARG_REVIEW_ID),
                        onOpenSubject = { review ->
                            val destination = when (review.subjectType) {
                                ReviewSubjectType.AGENT_RUN -> NavRoute.Runs.destination(review.subjectId)
                                ReviewSubjectType.PLAN_PROPOSAL -> NavRoute.Inbox.route
                                else -> NavRoute.Tasks.route
                            }
                            navController.navigate(destination) { launchSingleTop = true }
                        },
                        onOpenRun = openRun,
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
                        onOpenReview = { run ->
                            navController.navigate(NavRoute.Review.forRun(run.id)) {
                                launchSingleTop = true
                                popUpTo(NavRoute.Review.routePattern) { inclusive = true }
                            }
                        },
                        initialRunId = entry.arguments?.getString(NavRoute.Runs.ARG_RUN_ID),
                    )
                }
            }
            composable(NavRoute.Projects.routePattern, arguments = listOf(
                navArgument(NavRoute.Projects.ARG_PROJECT_ID) { type = NavType.StringType; nullable = true; defaultValue = null },
                navArgument(NavRoute.Projects.ARG_TASK_ID) { type = NavType.StringType; nullable = true; defaultValue = null },
            )) { entry ->
                if (workspaceMode == WorkspaceMode.SERVER) {
                    var projectThreadId by rememberSaveable { mutableStateOf<String?>(null) }
                    var projectThreadTitle by rememberSaveable { mutableStateOf<String?>(null) }
                    var projectThreadFocus by rememberSaveable { mutableStateOf(false) }
                    ProjectPlanScreen(
                        initialProjectId = entry.arguments?.getString(NavRoute.Projects.ARG_PROJECT_ID),
                        initialTaskId = entry.arguments?.getString(NavRoute.Projects.ARG_TASK_ID),
                        onBack = { navController.popBackStack() },
                        onOpenTask = { navController.navigate(NavRoute.Tasks.destination(it)) },
                        onOpenConversation = { id, title, _, focusInput ->
                            projectThreadTitle = title
                            projectThreadFocus = focusInput
                            projectThreadId = id
                        },
                        onOpenRun = { navController.navigate(NavRoute.Runs.destination(it)) },
                    )
                    projectThreadId?.let { id ->
                        ProjectAgentSheet(
                            conversationId = id,
                            title = projectThreadTitle,
                            focusInput = projectThreadFocus,
                            onDismiss = { projectThreadId = null },
                        )
                    }
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
                    onOpenDevices = { open(NavRoute.Devices.route) },
                    pushStatus = pushStatus,
                )
            }
        }
    }
    }
}

/** A server screen reached by deep link in a local workspace: offer the connection instead. */
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
