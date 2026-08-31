package com.clawchat.android.core.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.clawchat.android.core.R

/** Shared top-app-bar entry point for the app's mode-aware navigation drawer. */
@Composable
fun ClawNavigationMenuButton(onClick: () -> Unit) {
    IconButton(onClick = onClick) {
        Icon(
            imageVector = Icons.Default.Menu,
            contentDescription = stringResource(R.string.navigation_open_menu),
        )
    }
}
