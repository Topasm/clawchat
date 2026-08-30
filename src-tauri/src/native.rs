#[cfg(target_os = "macos")]
use tauri::menu::{MenuBuilder, SubmenuBuilder};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewWindow,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutostartExt};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use crate::{startup_log, state::AppState};

const QUICK_CAPTURE_SHORTCUT: &str = "CommandOrControl+Shift+Space";

#[cfg(target_os = "macos")]
const TRAY_ICON: tauri::image::Image<'static> =
    tauri::include_image!("./icons/tray-template-macos.png");

#[cfg(not(target_os = "macos"))]
const TRAY_ICON: tauri::image::Image<'static> = tauri::include_image!("./icons/tray-color.png");

pub fn setup(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    if let Err(error) = setup_app_menu(app) {
        startup_log::report(&format!(
            "[clawchat] macOS application menu is unavailable: {error}"
        ));
    }
    if let Err(error) = setup_tray(app) {
        startup_log::report(&format!("[clawchat] system tray is unavailable: {error}"));
    }
    setup_global_shortcut(app);
    setup_autostart(app);
}

pub fn show_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window does not exist".to_owned())?;
    show_window(&window)
}

/// Restore the main window through one observable path, regardless of whether
/// the request came from the Dock, tray, global shortcut, or a second launch.
pub fn restore_main_window(app: &tauri::AppHandle, source: &str) {
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

pub fn handle_quick_capture(app: &tauri::AppHandle) {
    restore_main_window(app, "quick capture");
    if let Err(error) = app.emit("open-quick-capture", ()) {
        startup_log::report(&format!("[clawchat] failed to open quick capture: {error}"));
    }
}

fn open_settings(app: &AppHandle, source: &str) {
    restore_main_window(app, source);
    if let Err(error) = app.emit("open-settings", ()) {
        startup_log::report(&format!(
            "[clawchat] failed to open Settings from {source}: {error}"
        ));
    }
}

fn navigate_main_window(app: &AppHandle, route: &str, source: &str) {
    restore_main_window(app, source);
    if let Err(error) = app.emit("navigate", route) {
        startup_log::report(&format!(
            "[clawchat] failed to navigate to {route} from {source}: {error}"
        ));
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

#[cfg(target_os = "macos")]
fn setup_app_menu(app: &AppHandle) -> tauri::Result<()> {
    let settings = MenuItem::with_id(
        app,
        "app-settings",
        "Settings…",
        true,
        Some("CmdOrCtrl+Comma"),
    )?;
    let connections = MenuItem::with_id(
        app,
        "app-connections",
        "Connections & Diagnostics…",
        true,
        None::<&str>,
    )?;
    let show = MenuItem::with_id(app, "app-show-main", "Show ClawChat", true, None::<&str>)?;
    let quick_capture = MenuItem::with_id(
        app,
        "app-quick-capture",
        "Quick Capture",
        true,
        Some("CmdOrCtrl+Shift+Space"),
    )?;
    let diagnostics = MenuItem::with_id(
        app,
        "app-diagnostics",
        "Open Diagnostics",
        true,
        None::<&str>,
    )?;

    let application_menu = SubmenuBuilder::new(app, "ClawChat")
        .about(None)
        .separator()
        .item(&settings)
        .item(&connections)
        .separator()
        .hide_with_text("Hide ClawChat")
        .hide_others_with_text("Hide Others")
        .show_all_with_text("Show All")
        .separator()
        .quit_with_text("Quit ClawChat")
        .build()?;
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&quick_capture)
        .separator()
        .close_window_with_text("Close Window")
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view_menu = SubmenuBuilder::new(app, "View").item(&show).build()?;
    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .separator()
        .close_window()
        .build()?;
    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&diagnostics)
        .build()?;
    let menu = MenuBuilder::new(app)
        .items(&[
            &application_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ])
        .build()?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| match event.id().as_ref() {
        "app-settings" => open_settings(app, "macOS Settings menu"),
        "app-connections" => navigate_main_window(app, "/connections", "macOS application menu"),
        "app-show-main" => restore_main_window(app, "macOS application menu"),
        "app-quick-capture" => handle_quick_capture(app),
        "app-diagnostics" => navigate_main_window(app, "/diagnostics", "macOS Help menu"),
        _ => {}
    });
    Ok(())
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

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show ClawChat", true, None::<&str>)?;
    let quick_capture =
        MenuItem::with_id(app, "quick-capture", "Quick Capture", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let connections = MenuItem::with_id(
        app,
        "open-connections",
        "Open Connections…",
        true,
        None::<&str>,
    )?;
    let stop = MenuItem::with_id(app, "stop-server", "Stop Server", true, None::<&str>)?;
    let restart = MenuItem::with_id(app, "restart-server", "Restart Server", true, None::<&str>)?;
    let first_separator = PredefinedMenuItem::separator(app)?;
    let second_separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit ClawChat", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &show,
            &quick_capture,
            &settings,
            &connections,
            &first_separator,
            &stop,
            &restart,
            &second_separator,
            &quit,
        ],
    )?;
    let builder = TrayIconBuilder::with_id("main-tray")
        .icon(TRAY_ICON)
        .icon_as_template(cfg!(target_os = "macos"))
        .menu(&menu)
        .tooltip("ClawChat")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => restore_main_window(app, "tray menu"),
            "quick-capture" => handle_quick_capture(app),
            "settings" => open_settings(app, "tray Settings"),
            "open-connections" => navigate_main_window(app, "/connections", "tray connections"),
            "stop-server" => {
                let state = app.state::<AppState>();
                if let Err(error) = state.stop_server(app) {
                    startup_log::report(&format!(
                        "[clawchat] failed to stop server from tray: {error}"
                    ));
                }
            }
            "restart-server" => {
                let state = app.state::<AppState>();
                if state
                    .config()
                    .map(|config| config.local_server_enabled)
                    .unwrap_or(false)
                {
                    if let Err(error) = state.restart_server(app) {
                        startup_log::report(&format!(
                            "[clawchat] failed to restart server from tray: {error}"
                        ));
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
                restore_main_window(tray.app_handle(), "tray icon");
            }
        });
    builder.build(app)?;
    Ok(())
}
