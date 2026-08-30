use tauri::{AppHandle, Emitter, Manager};

use crate::{startup_log, state::AppState};

use super::window::restore_main_window;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum NativeCommand {
    ShowMain,
    QuickCapture,
    Settings,
    Connections,
    Diagnostics,
    StopServer,
    RestartServer,
    Quit,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum AppMenuCommand {
    Settings,
    Connections,
    ShowMain,
    QuickCapture,
    Diagnostics,
}

impl AppMenuCommand {
    pub const fn id(self) -> &'static str {
        match self {
            Self::Settings => "app-settings",
            Self::Connections => "app-connections",
            Self::ShowMain => "app-show-main",
            Self::QuickCapture => "app-quick-capture",
            Self::Diagnostics => "app-diagnostics",
        }
    }

    pub const fn source(self) -> &'static str {
        match self {
            Self::Settings => "macOS Settings menu",
            Self::Diagnostics => "macOS Help menu",
            _ => "macOS application menu",
        }
    }

    pub const fn native_command(self) -> NativeCommand {
        match self {
            Self::Settings => NativeCommand::Settings,
            Self::Connections => NativeCommand::Connections,
            Self::ShowMain => NativeCommand::ShowMain,
            Self::QuickCapture => NativeCommand::QuickCapture,
            Self::Diagnostics => NativeCommand::Diagnostics,
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        [
            Self::Settings,
            Self::Connections,
            Self::ShowMain,
            Self::QuickCapture,
            Self::Diagnostics,
        ]
        .into_iter()
        .find(|command| command.id() == id)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum TrayMenuCommand {
    ShowMain,
    QuickCapture,
    Settings,
    Connections,
    StopServer,
    RestartServer,
    Quit,
}

impl TrayMenuCommand {
    pub const fn id(self) -> &'static str {
        match self {
            Self::ShowMain => "show",
            Self::QuickCapture => "quick-capture",
            Self::Settings => "settings",
            Self::Connections => "open-connections",
            Self::StopServer => "stop-server",
            Self::RestartServer => "restart-server",
            Self::Quit => "quit",
        }
    }

    pub const fn source(self) -> &'static str {
        match self {
            Self::ShowMain => "tray menu",
            Self::QuickCapture => "quick capture",
            Self::Settings => "tray Settings",
            Self::Connections => "tray connections",
            Self::StopServer => "tray Stop Server",
            Self::RestartServer => "tray Restart Server",
            Self::Quit => "tray Quit",
        }
    }

    pub const fn native_command(self) -> NativeCommand {
        match self {
            Self::ShowMain => NativeCommand::ShowMain,
            Self::QuickCapture => NativeCommand::QuickCapture,
            Self::Settings => NativeCommand::Settings,
            Self::Connections => NativeCommand::Connections,
            Self::StopServer => NativeCommand::StopServer,
            Self::RestartServer => NativeCommand::RestartServer,
            Self::Quit => NativeCommand::Quit,
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        [
            Self::ShowMain,
            Self::QuickCapture,
            Self::Settings,
            Self::Connections,
            Self::StopServer,
            Self::RestartServer,
            Self::Quit,
        ]
        .into_iter()
        .find(|command| command.id() == id)
    }
}

pub(super) fn dispatch(app: &AppHandle, command: NativeCommand, source: &str) {
    match command {
        NativeCommand::ShowMain => restore_main_window(app, source),
        NativeCommand::QuickCapture => {
            restore_main_window(app, source);
            if let Err(error) = app.emit("open-quick-capture", ()) {
                startup_log::report(&format!("[clawchat] failed to open quick capture: {error}"));
            }
        }
        NativeCommand::Settings => {
            restore_main_window(app, source);
            if let Err(error) = app.emit("open-settings", ()) {
                startup_log::report(&format!(
                    "[clawchat] failed to open Settings from {source}: {error}"
                ));
            }
        }
        NativeCommand::Connections => navigate(app, "/connections", source),
        NativeCommand::Diagnostics => navigate(app, "/diagnostics", source),
        NativeCommand::StopServer => {
            let state = app.state::<AppState>();
            if let Err(error) = state.stop_server(app) {
                startup_log::report(&format!(
                    "[clawchat] failed to stop server from tray: {error}"
                ));
            }
        }
        NativeCommand::RestartServer => {
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
        NativeCommand::Quit => app.exit(0),
    }
}

fn navigate(app: &AppHandle, route: &str, source: &str) {
    restore_main_window(app, source);
    if let Err(error) = app.emit("navigate", route) {
        startup_log::report(&format!(
            "[clawchat] failed to navigate to {route} from {source}: {error}"
        ));
    }
}
