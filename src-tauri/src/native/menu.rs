use tauri::{
    menu::{Menu, MenuBuilder, MenuItem, SubmenuBuilder},
    AppHandle, Wry,
};

use super::command::{dispatch, AppMenuCommand};
use super::labels::{text, Label, Language};

pub(super) fn setup(app: &AppHandle) -> tauri::Result<()> {
    app.set_menu(build(app, super::labels::current())?)?;
    app.on_menu_event(|app, event| {
        if let Some(command) = AppMenuCommand::from_id(event.id().as_ref()) {
            dispatch(app, command.native_command(), command.source());
        }
    });
    Ok(())
}

/// Rebuild the menu bar in another language; the handlers stay as they are,
/// since every item keeps its id.
pub(super) fn refresh(app: &AppHandle, language: Language) -> tauri::Result<()> {
    app.set_menu(build(app, language)?)?;
    Ok(())
}

fn build(app: &AppHandle, language: Language) -> tauri::Result<Menu<Wry>> {
    let label = |item: Label| text(language, item);
    let settings = MenuItem::with_id(
        app,
        AppMenuCommand::Settings.id(),
        label(Label::Settings),
        true,
        Some("CmdOrCtrl+Comma"),
    )?;
    let connections = MenuItem::with_id(
        app,
        AppMenuCommand::Connections.id(),
        label(Label::Connections),
        true,
        None::<&str>,
    )?;
    let show = MenuItem::with_id(
        app,
        AppMenuCommand::ShowMain.id(),
        label(Label::ShowClawChat),
        true,
        None::<&str>,
    )?;
    let quick_capture = MenuItem::with_id(
        app,
        AppMenuCommand::QuickCapture.id(),
        label(Label::QuickCapture),
        true,
        Some("CmdOrCtrl+Shift+Space"),
    )?;
    let diagnostics = MenuItem::with_id(
        app,
        AppMenuCommand::Diagnostics.id(),
        label(Label::OpenDiagnostics),
        true,
        None::<&str>,
    )?;

    let application_menu = SubmenuBuilder::new(app, "ClawChat")
        .about(None)
        .separator()
        .item(&settings)
        .item(&connections)
        .separator()
        .hide_with_text(label(Label::HideClawChat))
        .hide_others_with_text(label(Label::HideOthers))
        .show_all_with_text(label(Label::ShowAll))
        .separator()
        .quit_with_text(label(Label::QuitClawChat))
        .build()?;
    let file_menu = SubmenuBuilder::new(app, label(Label::File))
        .item(&quick_capture)
        .separator()
        .close_window_with_text(label(Label::CloseWindow))
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, label(Label::Edit))
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view_menu = SubmenuBuilder::new(app, label(Label::View))
        .item(&show)
        .build()?;
    let window_menu = SubmenuBuilder::new(app, label(Label::Window))
        .minimize()
        .separator()
        .close_window()
        .build()?;
    let help_menu = SubmenuBuilder::new(app, label(Label::Help))
        .item(&diagnostics)
        .build()?;
    MenuBuilder::new(app)
        .items(&[
            &application_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ])
        .build()
}
