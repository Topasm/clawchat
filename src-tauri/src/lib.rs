mod commands;
mod models;
mod native;
mod services;
mod startup_log;
mod state;

use state::{AppState, PendingUpdateState};
use tauri::Manager;

#[cfg(unix)]
fn install_termination_signal_handler<R: tauri::Runtime>(app_handle: tauri::AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        use tokio::signal::unix::{signal, SignalKind};

        let mut terminate = match signal(SignalKind::terminate()) {
            Ok(signal) => signal,
            Err(error) => {
                startup_log::report(&format!(
                    "[clawchat] failed to install SIGTERM handler: {error}"
                ));
                return;
            }
        };
        let mut interrupt = match signal(SignalKind::interrupt()) {
            Ok(signal) => signal,
            Err(error) => {
                startup_log::report(&format!(
                    "[clawchat] failed to install SIGINT handler: {error}"
                ));
                return;
            }
        };

        tokio::select! {
            _ = terminate.recv() => {}
            _ = interrupt.recv() => {}
        }
        startup_log::report("[clawchat] termination signal received; stopping local server");
        app_handle.exit(0);
    });
}

#[cfg(not(unix))]
fn install_termination_signal_handler<R: tauri::Runtime>(_app_handle: tauri::AppHandle<R>) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let application = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(
            |app, _arguments, _cwd| {
                native::show_main_window(app);
            },
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let is_host = window
                    .try_state::<AppState>()
                    .and_then(|state| state.config().ok())
                    .map(|config| matches!(config.app_mode, models::AppMode::Host))
                    .unwrap_or(false);
                if is_host {
                    api.prevent_close();
                    let _ = window.hide();
                } else {
                    window.app_handle().exit(0);
                }
            }
        })
        .setup(|app| {
            let state = match AppState::initialize(app.handle()) {
                Ok(state) => state,
                Err(error) => {
                    startup_log::report(&format!(
                        "[clawchat] failed to initialize application state: {error}"
                    ));
                    app.handle().exit(1);
                    return Ok(());
                }
            };
            let should_start_host = state.should_start_host();
            app.manage(state);
            app.manage(PendingUpdateState::default());
            install_termination_signal_handler(app.handle().clone());
            if should_start_host {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let state = app_handle.state::<AppState>();
                    match state.start_server(&app_handle) {
                        // `start_server` reports a blocked or crashed sidecar as an
                        // `Error` status rather than an `Err`, so the reason is only
                        // durable if this arm records it too.
                        Ok(status) => {
                            if let Some(error) = status.startup_failure() {
                                startup_log::report(&format!(
                                    "[clawchat] automatic host startup failed: {error}"
                                ));
                            }
                        }
                        Err(error) => {
                            startup_log::report(&format!(
                                "[clawchat] automatic host startup failed: {error}"
                            ));
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::server::server_get_status,
            commands::server::server_get_config,
            commands::server::server_get_network_info,
            commands::server::server_update_config,
            commands::server::server_select_folder,
            commands::server::server_open_obsidian_vault,
            commands::server::server_set_app_mode,
            commands::server::server_get_app_mode,
            commands::app::app_show_notification,
            commands::app::app_set_badge_count,
            commands::app::app_open_camera_settings,
            commands::app::secure_storage_get,
            commands::app::secure_storage_set,
            commands::app::secure_storage_remove,
            commands::app::updater_check,
            commands::app::updater_download,
            commands::app::updater_install,
        ])
        .build(tauri::generate_context!());

    let application = match application {
        Ok(application) => application,
        Err(error) => {
            startup_log::report(&format!("[clawchat] failed to build application: {error}"));
            std::process::exit(1);
        }
    };

    application.run(|app_handle, event| match event {
        tauri::RunEvent::Ready => {
            if app_handle.try_state::<AppState>().is_some() {
                let deferred_app_handle = app_handle.clone();
                if let Err(error) = app_handle.run_on_main_thread(move || {
                    native::setup(&deferred_app_handle);
                }) {
                    startup_log::report(&format!(
                        "[clawchat] failed to schedule native startup integrations: {error}"
                    ));
                }
            }
        }
        tauri::RunEvent::Exit => {
            if let Some(state) = app_handle.try_state::<AppState>() {
                if let Err(error) = state.stop_server(app_handle) {
                    startup_log::report(&format!(
                        "[clawchat] failed to stop server during shutdown: {error}"
                    ));
                }
            }
        }
        _ => {}
    });
}
