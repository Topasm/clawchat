mod command;
#[cfg(target_os = "macos")]
mod menu;
mod shortcuts;
mod tray;
mod window;

use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutostartExt};

use crate::{startup_log, state::AppState};

pub use window::restore_main_window;

pub fn setup(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    if let Err(error) = menu::setup(app) {
        startup_log::report(&format!(
            "[clawchat] macOS application menu is unavailable: {error}"
        ));
    }
    if let Err(error) = tray::setup(app) {
        startup_log::report(&format!("[clawchat] system tray is unavailable: {error}"));
    }
    shortcuts::setup(app);
    setup_autostart(app);
}

fn setup_autostart(app: &AppHandle) {
    let autostart_plugin =
        tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--autostart"]));
    match app.plugin(autostart_plugin) {
        Ok(()) => sync_autostart(app),
        Err(error) => startup_log::report(&format!(
            "[clawchat] autostart plugin is unavailable: {error}"
        )),
    }
}

fn sync_autostart(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        startup_log::report("[clawchat] skipped autostart synchronization: app state unavailable");
        return;
    };
    let enabled = state
        .config()
        .map(|config| config.local_server_enabled && config.auto_start_host)
        .unwrap_or(false);
    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    if let Err(error) = result {
        startup_log::report(&format!(
            "[clawchat] failed to synchronize autostart: {error}"
        ));
    }
}
