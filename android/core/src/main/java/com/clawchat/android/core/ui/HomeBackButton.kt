package com.clawchat.android.core.ui

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.clawchat.android.core.R

/**
 * Returns to the home list. Null where there is no home list underneath
 * (onboarding, or a screen composed on its own in a test), so the top bar
 * shows nothing instead of a button that leads nowhere.
 */
val LocalNavigateHome = staticCompositionLocalOf<(() -> Unit)?> { null }

/** "‹ Home" in the top bar: every screen is one step away from the home list. */
@Composable
fun HomeBackButton() {
    val navigateHome = LocalNavigateHome.current ?: return
    val description = stringResource(R.string.navigation_back_home_description)
    TextButton(
        onClick = navigateHome,
        modifier = Modifier.semantics { contentDescription = description },
        colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.primary),
    ) {
        Icon(
            Icons.AutoMirrored.Filled.ArrowBack,
            contentDescription = null,
            modifier = Modifier.size(18.dp),
        )
        Spacer(Modifier.width(4.dp))
        Text(stringResource(R.string.navigation_back_home))
    }
}
