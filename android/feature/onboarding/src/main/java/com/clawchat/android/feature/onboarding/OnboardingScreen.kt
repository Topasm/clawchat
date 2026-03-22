package com.clawchat.android.feature.onboarding

import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OnboardingScreen(
    onComplete: () -> Unit,
    viewModel: OnboardingViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()

    AnimatedContent(
        targetState = state.step,
        label = "onboarding_step",
    ) { step ->
        when (step) {
            OnboardingStep.WELCOME -> WelcomeStep(
                onNext = { viewModel.goToStep(OnboardingStep.SERVER) },
            )
            OnboardingStep.SERVER -> ServerStep(
                serverUrl = state.serverUrl,
                isChecking = state.isCheckingServer,
                serverReachable = state.serverReachable,
                error = state.error,
                onUrlChange = viewModel::updateServerUrl,
                onCheck = viewModel::checkServer,
                onNext = { viewModel.goToStep(OnboardingStep.PAIRING) },
                onManualLogin = { viewModel.goToStep(OnboardingStep.MANUAL_LOGIN) },
            )
            OnboardingStep.PAIRING -> PairingStep(
                code = state.pairingCode,
                isPairing = state.isPairing,
                error = state.error,
                onCodeChange = viewModel::updatePairingCode,
                onSubmit = viewModel::claimPairingCode,
                onBack = { viewModel.goToStep(OnboardingStep.SERVER) },
                onManualLogin = { viewModel.goToStep(OnboardingStep.MANUAL_LOGIN) },
            )
            OnboardingStep.MANUAL_LOGIN -> ManualLoginStep(
                pin = state.pin,
                isLoggingIn = state.isLoggingIn,
                error = state.error,
                onPinChange = viewModel::updatePin,
                onSubmit = viewModel::loginWithPin,
                onBack = { viewModel.goToStep(OnboardingStep.PAIRING) },
            )
            OnboardingStep.READY -> ReadyStep(onComplete = onComplete)
        }
    }
}

@Composable
private fun WelcomeStep(onNext: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "Welcome to ClawChat",
            style = MaterialTheme.typography.headlineLarge,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(16.dp))
        Text(
            "Your personal productivity hub with AI-powered chat, tasks, and calendar.",
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(48.dp))
        Button(onClick = onNext, modifier = Modifier.fillMaxWidth()) {
            Text("Get Started")
        }
    }
}

@Composable
private fun ServerStep(
    serverUrl: String,
    isChecking: Boolean,
    serverReachable: Boolean?,
    error: String?,
    onUrlChange: (String) -> Unit,
    onCheck: () -> Unit,
    onNext: () -> Unit,
    onManualLogin: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text("Connect to Server", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(8.dp))
        Text(
            "Enter the URL of your ClawChat server.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(24.dp))

        OutlinedTextField(
            value = serverUrl,
            onValueChange = onUrlChange,
            label = { Text("Server URL") },
            placeholder = { Text("http://192.168.1.100:8000") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { onCheck() }),
        )
        Spacer(Modifier.height(12.dp))

        if (isChecking) {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
        }

        if (serverReachable == true) {
            Text("Server is reachable", color = MaterialTheme.colorScheme.primary)
        }

        error?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }

        Spacer(Modifier.height(24.dp))

        Button(
            onClick = { if (serverReachable == true) onNext() else onCheck() },
            modifier = Modifier.fillMaxWidth(),
            enabled = serverUrl.isNotBlank() && !isChecking,
        ) {
            Text(if (serverReachable == true) "Next — Pair Device" else "Check Connection")
        }

        Spacer(Modifier.height(12.dp))

        OutlinedButton(
            onClick = onManualLogin,
            modifier = Modifier.fillMaxWidth(),
            enabled = serverReachable == true,
        ) {
            Text("Log in with PIN instead")
        }
    }
}

@Composable
private fun PairingStep(
    code: String,
    isPairing: Boolean,
    error: String?,
    onCodeChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onBack: () -> Unit,
    onManualLogin: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text("Pair with Desktop", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(8.dp))
        Text(
            "Open ClawChat on your desktop, go to Settings > Devices, and generate a pairing code.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(24.dp))

        OutlinedTextField(
            value = code,
            onValueChange = { if (it.length <= 6 && it.all(Char::isDigit)) onCodeChange(it) },
            label = { Text("6-digit pairing code") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { onSubmit() }),
        )

        error?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }

        Spacer(Modifier.height(24.dp))

        Button(
            onClick = onSubmit,
            modifier = Modifier.fillMaxWidth(),
            enabled = code.length == 6 && !isPairing,
        ) {
            if (isPairing) {
                CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(8.dp))
            }
            Text("Pair")
        }

        Spacer(Modifier.height(12.dp))

        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = onBack) { Text("Back") }
            TextButton(onClick = onManualLogin) { Text("Use PIN instead") }
        }
    }
}

@Composable
private fun ManualLoginStep(
    pin: String,
    isLoggingIn: Boolean,
    error: String?,
    onPinChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onBack: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text("Log in with PIN", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(8.dp))
        Text(
            "Enter your server's PIN to connect directly.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(24.dp))

        OutlinedTextField(
            value = pin,
            onValueChange = onPinChange,
            label = { Text("PIN") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { onSubmit() }),
        )

        error?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }

        Spacer(Modifier.height(24.dp))

        Button(
            onClick = onSubmit,
            modifier = Modifier.fillMaxWidth(),
            enabled = pin.isNotBlank() && !isLoggingIn,
        ) {
            if (isLoggingIn) {
                CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(8.dp))
            }
            Text("Log In")
        }

        Spacer(Modifier.height(12.dp))
        TextButton(onClick = onBack) { Text("Back") }
    }
}

@Composable
private fun ReadyStep(onComplete: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            Icons.Default.Check,
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = MaterialTheme.colorScheme.primary,
        )
        Spacer(Modifier.height(24.dp))
        Text(
            "You're all set!",
            style = MaterialTheme.typography.headlineMedium,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "ClawChat is ready to use.",
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(48.dp))
        Button(onClick = onComplete, modifier = Modifier.fillMaxWidth()) {
            Text("Enter ClawChat")
        }
    }
}
