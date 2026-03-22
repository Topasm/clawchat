package com.clawchat.android.navigation

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Today
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.clawchat.android.feature.chat.ChatScreen
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
    BottomNavItem(NavRoute.Today.route, Icons.Default.Today, "Today"),
    BottomNavItem(NavRoute.Chat.route, Icons.Default.Chat, "Chat"),
    BottomNavItem(NavRoute.Tasks.route, Icons.Default.CheckCircle, "Tasks"),
    BottomNavItem(NavRoute.Settings.route, Icons.Default.Settings, "Settings"),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClawChatNavGraph(isLoggedIn: Boolean) {
    val navController = rememberNavController()
    val startDestination = if (isLoggedIn) NavRoute.Today.route else NavRoute.Onboarding.route

    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = navBackStackEntry?.destination?.route
    val showBottomBar = currentRoute in bottomNavItems.map { it.route }

    Scaffold(
        bottomBar = {
            if (showBottomBar) {
                NavigationBar {
                    bottomNavItems.forEach { item ->
                        NavigationBarItem(
                            icon = { Icon(item.icon, contentDescription = item.label) },
                            label = { Text(item.label) },
                            selected = currentRoute == item.route,
                            onClick = {
                                navController.navigate(item.route) {
                                    popUpTo(navController.graph.findStartDestination().id) {
                                        saveState = true
                                    }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
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
                )
            }
            composable(NavRoute.Today.route) {
                TodayScreen()
            }
            composable(NavRoute.Chat.route) {
                ChatScreen()
            }
            composable(NavRoute.Tasks.route) {
                TasksScreen()
            }
            composable(NavRoute.Settings.route) {
                SettingsScreen(
                    onLoggedOut = {
                        navController.navigate(NavRoute.Onboarding.route) {
                            popUpTo(0) { inclusive = true }
                        }
                    },
                )
            }
        }
    }
}
