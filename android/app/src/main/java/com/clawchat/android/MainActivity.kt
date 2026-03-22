package com.clawchat.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.navigation.ClawChatNavGraph
import com.clawchat.android.ui.theme.ClawChatTheme
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject lateinit var sessionStore: SessionStore

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            val isLoggedIn by sessionStore.isLoggedIn.collectAsState(initial = false)
            val onboardingSkipped by sessionStore.onboardingSkipped.collectAsState(initial = false)
            val accentColor by sessionStore.accentColor.collectAsState(initial = "system")

            ClawChatTheme(accentColorKey = accentColor) {
                ClawChatNavGraph(isLoggedIn = isLoggedIn, onboardingSkipped = onboardingSkipped)
            }
        }
    }
}
