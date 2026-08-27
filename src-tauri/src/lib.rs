mod commands;
mod models;
mod native;
mod services;
mod state;

use state::{AppState, PendingUpdateState};
use tauri::Manager;

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
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if matches!(
                        event.state(),
                        tauri_plugin_global_shortcut::ShortcutState::Pressed
                    ) {
                        native::handle_quick_capture(app);
                    }
                })
                .build(),
        )
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                if state
                    .config()
                    .map(|config| matches!(config.app_mode, models::AppMode::Host))
                    .unwrap_or(false)
                {
                    api.prevent_close();
                    let _ = window.hide();
                } else {
                    window.app_handle().exit(0);
                }
            }
        })
        .setup(|app| {
            let state = AppState::initialize(app.handle()).map_err(std::io::Error::other)?;
            let should_start_host = state.should_start_host();
            app.manage(state);
            app.manage(PendingUpdateState::default());
            native::setup(app)?;
            if should_start_host {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let state = app_handle.state::<AppState>();
                    if let Err(error) = state.start_server(&app_handle) {
                        eprintln!("[clawchat] automatic host startup failed: {error}");
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
            commands::app::secure_storage_get,
            commands::app::secure_storage_set,
            commands::app::secure_storage_remove,
            commands::app::updater_check,
            commands::app::updater_download,
            commands::app::updater_install,
        ])
        .build(tauri::generate_context!())
        .expect("error while building ClawChat");

    application.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let state = app_handle.state::<AppState>();
            if let Err(error) = state.stop_server(app_handle) {
                eprintln!("[clawchat] failed to stop server during shutdown: {error}");
            }
        }
    });
}
