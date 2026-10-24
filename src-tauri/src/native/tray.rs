use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle,
};

use super::command::{dispatch, NativeCommand, TrayMenuCommand};
use super::labels::{text, Label, Language};

const TRAY_ID: &str = "main-tray";

#[cfg(target_os = "macos")]
const TRAY_ICON: tauri::image::Image<'static> =
    tauri::include_image!("icons/tray-template-macos.png");

#[cfg(not(target_os = "macos"))]
const TRAY_ICON: tauri::image::Image<'static> = tauri::include_image!("icons/tray-color.png");

pub(super) fn setup(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app, super::labels::current())?;
    let builder = TrayIconBuilder::with_id(TRAY_ID)
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

/// Rebuild the tray menu in another language; item ids, and so the handlers,
/// stay the same. Nothing happens where the tray could not be created.
pub(super) fn refresh(app: &AppHandle, language: Language) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(build_menu(app, language)?))?;
    }
    Ok(())
}

fn build_menu(app: &AppHandle, language: Language) -> tauri::Result<Menu<tauri::Wry>> {
    let label = |item: Label| text(language, item);
    let show = menu_item(app, TrayMenuCommand::ShowMain, label(Label::ShowClawChat))?;
    let quick_capture = menu_item(
        app,
        TrayMenuCommand::QuickCapture,
        label(Label::QuickCapture),
    )?;
    let settings = menu_item(app, TrayMenuCommand::Settings, label(Label::Settings))?;
    let connections = menu_item(
        app,
        TrayMenuCommand::Connections,
        label(Label::OpenConnections),
    )?;
    let stop = menu_item(app, TrayMenuCommand::StopServer, label(Label::StopServer))?;
    let restart = menu_item(
        app,
        TrayMenuCommand::RestartServer,
        label(Label::RestartServer),
    )?;
    let first_separator = PredefinedMenuItem::separator(app)?;
    let second_separator = PredefinedMenuItem::separator(app)?;
    let quit = menu_item(app, TrayMenuCommand::Quit, label(Label::QuitClawChat))?;
    Menu::with_items(
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
    )
}

fn menu_item(
    app: &AppHandle,
    command: TrayMenuCommand,
    label: &str,
) -> tauri::Result<MenuItem<tauri::Wry>> {
    MenuItem::with_id(app, command.id(), label, true, None::<&str>)
}
