package com.clawchat.android.navigation

import androidx.annotation.StringRes
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.ui.graphics.vector.ImageVector
import com.clawchat.android.R
import com.clawchat.android.core.ui.icons.ClawIcons

/** A destination always has both a readable label and a recognizable icon. */
internal data class DrawerDestination(
    val route: String,
    @StringRes val labelRes: Int,
    val icon: ImageVector,
)

internal val allDrawerDestinations = listOf(
    DrawerDestination(NavRoute.Progress.route, R.string.nav_progress, Icons.Default.Notifications),
    DrawerDestination(NavRoute.Tasks.route, R.string.nav_tasks, ClawIcons.Checklist),
    DrawerDestination(NavRoute.Today.route, R.string.nav_schedule, ClawIcons.Today),
    DrawerDestination(NavRoute.Chat.route, R.string.nav_chat, ClawIcons.Chat),
    DrawerDestination(NavRoute.Inbox.route, R.string.nav_inbox, ClawIcons.Inbox),
    DrawerDestination(NavRoute.Projects.route, R.string.nav_projects, ClawIcons.Folder),
    DrawerDestination(NavRoute.Search.route, R.string.nav_search, Icons.Default.Search),
    DrawerDestination(NavRoute.Settings.route, R.string.nav_settings, Icons.Default.Settings),
)
