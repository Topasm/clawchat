use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewWindow,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutostartExt};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use crate::{models::AppMode, startup_log, state::AppState};

const QUICK_CAPTURE_SHORTCUT: &str = "CommandOrControl+Shift+Space";

pub fn setup(app: &AppHandle) {
    if let Err(error) = setup_tray(app) {
        startup_log::report(&format!("[clawchat] system tray is unavailable: {error}"));
    }
    setup_global_shortcut(app);
    setup_autostart(app);
}

pub fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        show_window(&window);
    }
}

pub fn handle_quick_capture(app: &tauri::AppHandle) {
    show_main_window(app);
    let _ = app.emit("open-quick-capture", ());
}

fn show_window(window: &WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

fn setup_global_shortcut(app: &AppHandle) {
    let global_shortcut_plugin = tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
            if matches!(
                event.state(),
                tauri_plugin_global_shortcut::ShortcutState::Pressed
            ) {
                handle_quick_capture(app);
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
        .map(|config| matches!(config.app_mode, AppMode::Host) && config.auto_start_host)
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

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show ClawChat", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop-server", "Stop Server", true, None::<&str>)?;
    let restart = MenuItem::with_id(app, "restart-server", "Restart Server", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit ClawChat", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &stop, &restart, &separator, &quit])?;
    let mut builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .tooltip("ClawChat")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "stop-server" => {
                let state = app.state::<AppState>();
                if let Err(error) = state.stop_server(app) {
                    eprintln!("[clawchat] failed to stop server from tray: {error}");
                }
            }
            "restart-server" => {
                let state = app.state::<AppState>();
                if state
                    .config()
                    .map(|config| matches!(config.app_mode, AppMode::Host))
                    .unwrap_or(false)
                {
                    if let Err(error) = state.restart_server(app) {
                        eprintln!("[clawchat] failed to restart server from tray: {error}");
                    }
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}
