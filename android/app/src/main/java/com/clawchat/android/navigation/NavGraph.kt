package com.clawchat.android.navigation

import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import com.clawchat.android.core.ui.icons.ClawIcons
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.clawchat.android.feature.chat.ChatScreen
import com.clawchat.android.feature.inbox.InboxScreen
import com.clawchat.android.feature.onboarding.OnboardingScreen
import com.clawchat.android.feature.settings.SettingsScreen
import com.clawchat.android.feature.tasks.TasksScreen
import com.clawchat.android.feature.today.TodayScreen

data class BottomNavItem(
    val route: String,
    val icon: ImageVector,
    val label: String,
)

val bottomNavItems = listOf(
    BottomNavItem(NavRoute.Today.route, ClawIcons.Today, "Today"),
    BottomNavItem(NavRoute.Inbox.route, ClawIcons.Inbox, "Inbox"),
    BottomNavItem(NavRoute.Chat.route, ClawIcons.Chat, "Chat"),
    BottomNavItem(NavRoute.Tasks.route, ClawIcons.Checklist, "Tasks"),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClawChatNavGraph(isLoggedIn: Boolean, onboardingSkipped: Boolean = false) {
    val navController = rememberNavController()
    val startDestination = if (isLoggedIn || onboardingSkipped) NavRoute.Today.route else NavRoute.Onboarding.route

    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = navBackStackEntry?.destination?.route
    val showBottomBar = currentRoute in bottomNavItems.map { it.route }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.surface,
        bottomBar = {
            if (showBottomBar) {
                NavigationBar(
                    containerColor = MaterialTheme.colorScheme.surface,
                    tonalElevation = 0.dp,
                    modifier = Modifier.height(56.dp),
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
                                indicatorColor = MaterialTheme.colorScheme.surface,
                            ),
                        )
                    }
                }
            }
        },
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = startDestination,
            modifier = Modifier.padding(innerPadding),
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
                    onNavigateToSettings = {
                        navController.navigate(NavRoute.Settings.route)
                    },
                )
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
