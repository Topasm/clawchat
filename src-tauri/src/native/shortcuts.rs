use tauri::AppHandle;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use crate::startup_log;

use super::command::{dispatch, NativeCommand};

const QUICK_CAPTURE_SHORTCUT: &str = "CommandOrControl+Shift+Space";

pub(super) fn setup(app: &AppHandle) {
    let global_shortcut_plugin = tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
            if matches!(
                event.state(),
                tauri_plugin_global_shortcut::ShortcutState::Pressed
            ) {
                dispatch(app, NativeCommand::QuickCapture, "quick capture");
            }
        })
        .build();

    match app.plugin(global_shortcut_plugin) {
        Ok(()) => {
            if let Err(error) = app.global_shortcut().register(QUICK_CAPTURE_SHORTCUT) {
                startup_log::report(&format!(
                    "[clawchat] quick capture shortcut is unavailable: {error}"
                ));
            }
        }
        Err(error) => {
            startup_log::report(&format!(
                "[clawchat] global shortcut plugin is unavailable: {error}"
            ));
        }
    }
}
