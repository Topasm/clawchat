package com.clawchat.app;

import android.util.Log;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor plugin that wraps Android BiometricPrompt for fingerprint/face auth.
 * Works because BridgeActivity -> AppCompatActivity -> FragmentActivity.
 */
@CapacitorPlugin(name = "Biometric")
public class BiometricPlugin extends Plugin {

    private static final String TAG = "BiometricPlugin";

    @PluginMethod
    public void isAvailable(PluginCall call) {
        BiometricManager manager = BiometricManager.from(getContext());
        int result = manager.canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_STRONG |
            BiometricManager.Authenticators.BIOMETRIC_WEAK
        );

        com.getcapacitor.JSObject ret = new com.getcapacitor.JSObject();
        switch (result) {
            case BiometricManager.BIOMETRIC_SUCCESS:
                ret.put("available", true);
                ret.put("reason", "ready");
                break;
            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE:
                ret.put("available", false);
                ret.put("reason", "no_hardware");
                break;
            case BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE:
                ret.put("available", false);
                ret.put("reason", "hw_unavailable");
                break;
            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED:
                ret.put("available", false);
                ret.put("reason", "none_enrolled");
                break;
            default:
                ret.put("available", false);
                ret.put("reason", "unknown");
                break;
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void authenticate(PluginCall call) {
        String title = call.getString("title", "Unlock ClawChat");
        String subtitle = call.getString("subtitle", "Verify your identity");

        FragmentActivity activity = getActivity();
        if (activity == null) {
            call.reject("Activity not available");
            return;
        }

        activity.runOnUiThread(() -> {
            try {
                BiometricPrompt.PromptInfo promptInfo = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setSubtitle(subtitle)
                    .setNegativeButtonText("Use PIN")
                    .setAllowedAuthenticators(
                        BiometricManager.Authenticators.BIOMETRIC_STRONG |
                        BiometricManager.Authenticators.BIOMETRIC_WEAK
                    )
                    .build();

                BiometricPrompt biometricPrompt = new BiometricPrompt(
                    activity,
                    ContextCompat.getMainExecutor(getContext()),
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                            super.onAuthenticationSucceeded(result);
                            Log.d(TAG, "Authentication succeeded");
                            com.getcapacitor.JSObject ret = new com.getcapacitor.JSObject();
                            ret.put("success", true);
                            call.resolve(ret);
                        }

                        @Override
                        public void onAuthenticationError(int errorCode, CharSequence errString) {
                            super.onAuthenticationError(errorCode, errString);
                            Log.d(TAG, "Authentication error: " + errString);
                            com.getcapacitor.JSObject ret = new com.getcapacitor.JSObject();
                            ret.put("success", false);
                            ret.put("error", errString.toString());
                            ret.put("errorCode", errorCode);
                            call.resolve(ret);
                        }

                        @Override
                        public void onAuthenticationFailed() {
                            super.onAuthenticationFailed();
                            Log.d(TAG, "Authentication failed (retry)");
                            // Don't resolve — biometric prompt stays open for retry
                        }
                    }
                );

                biometricPrompt.authenticate(promptInfo);
            } catch (Exception e) {
                Log.e(TAG, "Failed to show biometric prompt", e);
                call.reject("Failed to show biometric prompt: " + e.getMessage());
            }
        });
    }
}
