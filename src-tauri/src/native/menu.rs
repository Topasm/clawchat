use tauri::{
    menu::{MenuBuilder, MenuItem, SubmenuBuilder},
    AppHandle,
};

use super::command::{dispatch, AppMenuCommand};

pub(super) fn setup(app: &AppHandle) -> tauri::Result<()> {
    let settings = MenuItem::with_id(
        app,
        AppMenuCommand::Settings.id(),
        "Settings…",
        true,
        Some("CmdOrCtrl+Comma"),
    )?;
    let connections = MenuItem::with_id(
        app,
        AppMenuCommand::Connections.id(),
        "Connections & Diagnostics…",
        true,
        None::<&str>,
    )?;
    let show = MenuItem::with_id(
        app,
        AppMenuCommand::ShowMain.id(),
        "Show ClawChat",
        true,
        None::<&str>,
    )?;
    let quick_capture = MenuItem::with_id(
        app,
        AppMenuCommand::QuickCapture.id(),
        "Quick Capture",
        true,
        Some("CmdOrCtrl+Shift+Space"),
    )?;
    let diagnostics = MenuItem::with_id(
        app,
        AppMenuCommand::Diagnostics.id(),
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
    app.on_menu_event(|app, event| {
        if let Some(command) = AppMenuCommand::from_id(event.id().as_ref()) {
            dispatch(app, command.native_command(), command.source());
        }
    });
    Ok(())
}
