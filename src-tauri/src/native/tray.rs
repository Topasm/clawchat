use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle,
};

use super::command::{dispatch, NativeCommand, TrayMenuCommand};

#[cfg(target_os = "macos")]
const TRAY_ICON: tauri::image::Image<'static> =
    tauri::include_image!("../icons/tray-template-macos.png");

#[cfg(not(target_os = "macos"))]
const TRAY_ICON: tauri::image::Image<'static> = tauri::include_image!("../icons/tray-color.png");

pub(super) fn setup(app: &AppHandle) -> tauri::Result<()> {
    let show = menu_item(app, TrayMenuCommand::ShowMain, "Show ClawChat")?;
    let quick_capture = menu_item(app, TrayMenuCommand::QuickCapture, "Quick Capture")?;
    let settings = menu_item(app, TrayMenuCommand::Settings, "Settings…")?;
    let connections = menu_item(app, TrayMenuCommand::Connections, "Open Connections…")?;
    let stop = menu_item(app, TrayMenuCommand::StopServer, "Stop Server")?;
    let restart = menu_item(app, TrayMenuCommand::RestartServer, "Restart Server")?;
    let first_separator = PredefinedMenuItem::separator(app)?;
    let second_separator = PredefinedMenuItem::separator(app)?;
    let quit = menu_item(app, TrayMenuCommand::Quit, "Quit ClawChat")?;
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
        .on_menu_event(|app, event| {
            if let Some(command) = TrayMenuCommand::from_id(event.id().as_ref()) {
                dispatch(app, command.native_command(), command.source());
            }
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
                dispatch(tray.app_handle(), NativeCommand::ShowMain, "tray icon");
            }
        });
    builder.build(app)?;
    Ok(())
}

fn menu_item(
    app: &AppHandle,
    command: TrayMenuCommand,
    label: &str,
) -> tauri::Result<MenuItem<tauri::Wry>> {
    MenuItem::with_id(app, command.id(), label, true, None::<&str>)
}
