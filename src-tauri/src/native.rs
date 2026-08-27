use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, Emitter, Manager, WebviewWindow,
};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use crate::{models::AppMode, state::AppState};

const QUICK_CAPTURE_SHORTCUT: &str = "CommandOrControl+Shift+Space";

pub fn setup(app: &mut App) -> tauri::Result<()> {
    setup_tray(app)?;
    if let Err(error) = app.global_shortcut().register(QUICK_CAPTURE_SHORTCUT) {
        eprintln!("[clawchat] quick capture shortcut is unavailable: {error}");
    }
    sync_autostart(app);
    Ok(())
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

fn sync_autostart(app: &App) {
    let state = app.state::<AppState>();
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
        eprintln!("[clawchat] failed to synchronize autostart: {error}");
    }
}

fn setup_tray(app: &App) -> tauri::Result<()> {
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
