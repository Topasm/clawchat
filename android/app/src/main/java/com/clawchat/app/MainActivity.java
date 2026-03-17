package com.clawchat.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends BridgeActivity {

    private static final String PREFS_NAME = "clawchat_widget";
    private static final String KEY_SERVER_URL = "server_url";
    private static final String KEY_AUTH_TOKEN = "auth_token";
    private static final int MAX_TITLE_LENGTH = 200;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WidgetDataPlugin.class);
        super.onCreate(savedInstanceState);

        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);

        handleWidgetRoute(getIntent());
        handleShareIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleWidgetRoute(intent);
        handleShareIntent(intent);
    }

    private void handleWidgetRoute(Intent intent) {
        if (intent == null) return;
        String route = intent.getStringExtra("widget_route");
        if (route != null && !route.isEmpty()) {
            getBridge().getWebView().post(() -> {
                getBridge().getWebView().evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('widget:navigate', { detail: '" + route + "' }));",
                    null
                );
            });
            intent.removeExtra("widget_route");
        }
    }

    private void handleShareIntent(Intent intent) {
        if (intent == null) return;
        if (!Intent.ACTION_SEND.equals(intent.getAction())) return;
        if (!"text/plain".equals(intent.getType())) return;

        String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (sharedText == null || sharedText.trim().isEmpty()) return;

        // Truncate to max title length
        String title = sharedText.trim();
        if (title.length() > MAX_TITLE_LENGTH) {
            title = title.substring(0, MAX_TITLE_LENGTH);
        }

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String serverUrl = prefs.getString(KEY_SERVER_URL, "");
        String token = prefs.getString(KEY_AUTH_TOKEN, "");

        if (serverUrl == null || serverUrl.isEmpty() || token == null || token.isEmpty()) {
            Toast.makeText(this, "Please open ClawChat first to sign in", Toast.LENGTH_SHORT).show();
            intent.setAction(null);
            return;
        }

        createTodoFromShare(serverUrl, token, title);

        // Clear intent action to prevent re-processing
        intent.setAction(null);
    }

    private void createTodoFromShare(String serverUrl, String token, String title) {
        executor.execute(() -> {
            int responseCode = -1;
            try {
                URL url = new URL(serverUrl + "/api/todos");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Authorization", "Bearer " + token);
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);

                JSONObject body = new JSONObject();
                body.put("title", title);

                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body.toString().getBytes(StandardCharsets.UTF_8));
                }

                responseCode = conn.getResponseCode();
                conn.disconnect();
            } catch (Exception ignored) {}

            final int code = responseCode;
            runOnUiThread(() -> {
                if (code == 200 || code == 201) {
                    Toast.makeText(this, "Todo created from shared text", Toast.LENGTH_SHORT).show();
                    // Dispatch app:resume to refresh webview data
                    getBridge().getWebView().post(() -> {
                        getBridge().getWebView().evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('app:resume'));",
                            null
                        );
                    });
                } else if (code == 401) {
                    Toast.makeText(this, "Session expired — please open ClawChat to re-login", Toast.LENGTH_LONG).show();
                } else {
                    Toast.makeText(this, "Failed to create todo", Toast.LENGTH_SHORT).show();
                }
            });
        });
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        executor.shutdownNow();
    }
}
