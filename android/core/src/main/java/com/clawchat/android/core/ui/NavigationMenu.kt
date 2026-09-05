package com.clawchat.android.core.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.res.stringResource
import com.clawchat.android.core.R

val LocalOpenNavigationMenu = staticCompositionLocalOf<(() -> Unit)?> { null }

@Composable
fun NavigationMenuButton() {
    val open = LocalOpenNavigationMenu.current ?: return
    IconButton(onClick = open) {
        Icon(Icons.Default.Menu, contentDescription = stringResource(R.string.navigation_open_menu))
    }
}
