package com.clawchat.app;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.widget.EditText;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class QuickAddTaskActivity extends AppCompatActivity {

    private static final String PREFS_NAME = "clawchat_widget";
    private static final String KEY_SERVER_URL = "server_url";
    private static final String KEY_AUTH_TOKEN = "auth_token";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String serverUrl = prefs.getString(KEY_SERVER_URL, "");
        String token = prefs.getString(KEY_AUTH_TOKEN, "");

        if (serverUrl == null || serverUrl.isEmpty() || token == null || token.isEmpty()) {
            Toast.makeText(this, "Please open ClawChat first to sign in", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }

        showQuickAddDialog(serverUrl, token);
    }

    private void showQuickAddDialog(String serverUrl, String token) {
        EditText input = new EditText(this);
        input.setHint("Task title");
        input.setSingleLine(true);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        input.setPadding(pad, pad, pad, pad);

        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("Quick Add Task")
            .setView(input)
            .setPositiveButton("Add", null) // set listener below to prevent auto-dismiss
            .setNegativeButton("Cancel", (d, w) -> finish())
            .setOnCancelListener(d -> finish())
            .create();

        dialog.setOnShowListener(d -> {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
                String title = input.getText().toString().trim();
                if (title.isEmpty()) return;
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
                dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setEnabled(false);
                createTask(serverUrl, token, title, dialog);
            });
        });

        input.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {}
            @Override
            public void afterTextChanged(Editable s) {
                if (dialog.isShowing()) {
                    dialog.getButton(AlertDialog.BUTTON_POSITIVE)
                        .setEnabled(s.toString().trim().length() > 0);
                }
            }
        });

        dialog.show();
        input.requestFocus();
    }

    private void createTask(String serverUrl, String token, String title, AlertDialog dialog) {
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
                dialog.dismiss();
                if (code == 200 || code == 201) {
                    Toast.makeText(this, "Task added", Toast.LENGTH_SHORT).show();
                    refreshWidget();
                } else if (code == 401) {
                    Toast.makeText(this, "Session expired — please open ClawChat to re-login", Toast.LENGTH_LONG).show();
                } else {
                    Toast.makeText(this, "Failed to add task", Toast.LENGTH_SHORT).show();
                }
                finish();
            });
        });
    }

    private void refreshWidget() {
        AppWidgetManager manager = AppWidgetManager.getInstance(this);
        ComponentName widget = new ComponentName(this, TodayWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(widget);
        if (ids.length > 0) {
            Intent intent = new Intent(this, TodayWidgetProvider.class);
            intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
            intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
            sendBroadcast(intent);
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        executor.shutdownNow();
    }
}
