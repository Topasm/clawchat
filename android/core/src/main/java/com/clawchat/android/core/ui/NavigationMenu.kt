package com.clawchat.android.core.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.res.stringResource
import com.clawchat.android.core.R

val LocalOpenNavigationMenu = staticCompositionLocalOf<(() -> Unit)?> { null }

/** Runs waiting for the user. Shown on the menu button so it is visible before the drawer opens. */
val LocalAttentionCount = staticCompositionLocalOf { 0 }

@Composable
fun NavigationMenuButton() {
    val open = LocalOpenNavigationMenu.current ?: return
    val attention = LocalAttentionCount.current
    IconButton(onClick = open) {
        BadgedBox(
            badge = {
                if (attention > 0) {
                    Badge { Text(if (attention > 99) "99+" else attention.toString()) }
                }
            },
        ) {
            Icon(Icons.Default.Menu, contentDescription = stringResource(R.string.navigation_open_menu))
        }
    }
}
