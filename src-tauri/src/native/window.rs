use tauri::{AppHandle, Manager, WebviewWindow};

use crate::startup_log;

pub fn show_main_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window does not exist".to_owned())?;
    show_window(&window)
}

/// Restore the main window through one observable path, regardless of whether
/// the request came from the Dock, tray, global shortcut, or a second launch.
pub fn restore_main_window(app: &AppHandle, source: &str) {
    startup_log::report(&format!(
        "[clawchat] main window restore requested by {source}"
    ));
    match show_main_window(app) {
        Ok(()) => startup_log::report("[clawchat] main window shown and focused"),
        Err(error) => startup_log::report(&format!(
            "[clawchat] failed to restore main window from {source}: {error}"
        )),
    }
}

fn show_window(window: &WebviewWindow) -> Result<(), String> {
    window
        .unminimize()
        .map_err(|error| format!("failed to unminimize: {error}"))?;
    window
        .show()
        .map_err(|error| format!("failed to show: {error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("failed to focus: {error}"))?;
    Ok(())
}
