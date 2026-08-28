use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;
use tokio::sync::Notify;

use crate::{
    models::{UpdateDownloadProgress, UpdateInfo},
    services::{
        secure_storage,
        updater_policy::{exceeds_download_limit, validate_release_fields, MAX_UPDATE_BYTES},
    },
    state::{AppState, PendingUpdateState},
};

const UPDATE_CHECK_TIMEOUT: Duration = Duration::from_secs(30);
const UPDATE_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(10 * 60);

enum DownloadOutcome {
    Completed(tauri_plugin_updater::Result<Vec<u8>>),
    TimedOut,
    TooLarge,
}

#[tauri::command]
pub fn app_show_notification<R: Runtime>(
    app: AppHandle<R>,
    title: String,
    body: String,
    options: Option<serde_json::Value>,
) -> Result<(), String> {
    let _ = options;
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| format!("failed to show notification: {error}"))
}

#[tauri::command]
pub fn app_set_badge_count<R: Runtime>(app: AppHandle<R>, count: u32) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is not available".to_owned())?;
    window
        .set_badge_count((count > 0).then_some(i64::from(count)))
        .map_err(|error| format!("failed to set application badge: {error}"))
}

#[tauri::command]
pub async fn secure_storage_get(key: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || secure_storage::get(&key))
        .await
        .map_err(|error| format!("secure storage worker failed: {error}"))?
}

#[tauri::command]
pub async fn secure_storage_set(key: String, value: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || secure_storage::set(&key, &value))
        .await
        .map_err(|error| format!("secure storage worker failed: {error}"))?
}

#[tauri::command]
pub async fn secure_storage_remove(key: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || secure_storage::remove(&key))
        .await
        .map_err(|error| format!("secure storage worker failed: {error}"))?
}

#[tauri::command]
pub async fn updater_check<R: Runtime>(
    app: AppHandle<R>,
    pending: State<'_, PendingUpdateState>,
) -> Result<Option<UpdateInfo>, String> {
    let _operation = pending.begin_operation()?;
    if let Some(update) = pending.ready_update()? {
        let info = update_info(&update);
        app.emit("update-available", info.clone())
            .map_err(|error| format!("failed to emit update availability: {error}"))?;
        app.emit("update-downloaded", ())
            .map_err(|error| format!("failed to emit downloaded update: {error}"))?;
        return Ok(Some(info));
    }

    pending.clear()?;
    let updater = match app.updater_builder().timeout(UPDATE_CHECK_TIMEOUT).build() {
        Ok(updater) => updater,
        Err(tauri_plugin_updater::Error::EmptyEndpoints) => return Ok(None),
        Err(error) => return Err(format!("failed to initialize updater: {error}")),
    };
    let update = match updater.check().await {
        Ok(update) => update,
        Err(tauri_plugin_updater::Error::EmptyEndpoints) => return Ok(None),
        Err(error) => return Err(format!("failed to check for updates: {error}")),
    };
    if let Some(mut update) = update {
        validate_release_fields(
            &update.download_url,
            &update.signature,
            update.body.as_deref(),
            &update.version,
        )?;
        update.raw_json = serde_json::Value::Null;
        update.timeout = Some(UPDATE_DOWNLOAD_TIMEOUT);
        let info = update_info(&update);
        pending.set_update(update)?;
        app.emit("update-available", info.clone())
            .map_err(|error| format!("failed to emit update availability: {error}"))?;
        return Ok(Some(info));
    }
    app.emit("update-not-available", ())
        .map_err(|error| format!("failed to emit update result: {error}"))?;
    Ok(None)
}

#[tauri::command]
pub async fn updater_download<R: Runtime>(
    app: AppHandle<R>,
    pending: State<'_, PendingUpdateState>,
) -> Result<(), String> {
    let _operation = pending.begin_operation()?;
    let update = pending.update()?;
    let limit_exceeded = Arc::new(AtomicBool::new(false));
    let limit_notify = Arc::new(Notify::new());
    let progress_limit_exceeded = Arc::clone(&limit_exceeded);
    let progress_limit_notify = Arc::clone(&limit_notify);
    let mut downloaded_bytes = 0_u64;
    let progress_app = app.clone();
    let outcome = tokio::select! {
        biased;
        _ = limit_notify.notified() => DownloadOutcome::TooLarge,
        result = update.download(
            move |chunk_length, total_bytes| {
                downloaded_bytes = downloaded_bytes
                    .saturating_add(u64::try_from(chunk_length).unwrap_or(u64::MAX));
                if exceeds_download_limit(downloaded_bytes, total_bytes)
                    && !progress_limit_exceeded.swap(true, Ordering::Release)
                {
                    progress_limit_notify.notify_one();
                }
                let percent = total_bytes
                    .filter(|total| *total > 0)
                    .map(|total| (downloaded_bytes as f64 / total as f64 * 100.0).min(100.0));
                let _ = progress_app.emit(
                    "update-download-progress",
                    UpdateDownloadProgress {
                        downloaded_bytes,
                        total_bytes,
                        percent,
                    },
                );
            },
            || {},
        ) => DownloadOutcome::Completed(result),
        _ = tokio::time::sleep(UPDATE_DOWNLOAD_TIMEOUT) => DownloadOutcome::TimedOut,
    };
    let bytes = match outcome {
        DownloadOutcome::Completed(Ok(bytes))
            if !limit_exceeded.load(Ordering::Acquire)
                && u64::try_from(bytes.len()).unwrap_or(u64::MAX) <= MAX_UPDATE_BYTES =>
        {
            bytes
        }
        DownloadOutcome::Completed(Ok(_)) | DownloadOutcome::TooLarge => {
            return Err(format!(
                "update package exceeds the {} MiB safety limit",
                MAX_UPDATE_BYTES / (1024 * 1024)
            ));
        }
        DownloadOutcome::TimedOut => {
            return Err("update download timed out".to_owned());
        }
        DownloadOutcome::Completed(Err(error)) => {
            return Err(format!("failed to download update: {error}"));
        }
    };
    pending.set_download(bytes)?;
    app.emit("update-downloaded", ())
        .map_err(|error| format!("failed to emit downloaded update: {error}"))
}

#[tauri::command]
pub async fn updater_install<R: Runtime>(
    app: AppHandle<R>,
    pending: State<'_, PendingUpdateState>,
    server_state: State<'_, AppState>,
) -> Result<(), String> {
    let _operation = pending.begin_operation()?;
    let (update, bytes) = pending.take_download()?;
    let should_restart_server = server_state.should_start_host();
    server_state.stop_server(&app)?;
    let staged = Arc::new((update, bytes));
    let install_staged = Arc::clone(&staged);
    let install_result =
        tauri::async_runtime::spawn_blocking(move || install_staged.0.install(&install_staged.1))
            .await;
    match install_result {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            restore_staged_update(&pending, staged)?;
            if should_restart_server {
                let _ = server_state.start_server(&app);
            }
            return Err(format!("failed to install update: {error}"));
        }
        Err(error) => {
            restore_staged_update(&pending, staged)?;
            if should_restart_server {
                let _ = server_state.start_server(&app);
            }
            return Err(format!("update installation worker failed: {error}"));
        }
    }
    app.restart();
}

fn restore_staged_update(
    pending: &PendingUpdateState,
    staged: Arc<(tauri_plugin_updater::Update, Vec<u8>)>,
) -> Result<(), String> {
    let (update, bytes) = Arc::try_unwrap(staged)
        .map_err(|_| "update installation worker did not release staged data".to_owned())?;
    pending.restore_download(update, bytes)
}

fn update_info(update: &tauri_plugin_updater::Update) -> UpdateInfo {
    UpdateInfo {
        version: update.version.clone(),
        release_notes: update.body.clone(),
    }
}
