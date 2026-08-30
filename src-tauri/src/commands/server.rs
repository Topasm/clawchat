use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_autostart::AutoLaunchManager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::{
    models::{
        AppMode, LocalServerTransitionResult, LocalSession, NetworkAddress, NetworkInfo,
        RedactedServerConfig, ServerConfig, ServerConfigPatch, ServerState, ServerStatus,
    },
    services::local_session::issue_local_session,
    startup_log,
    state::AppState,
};

#[tauri::command]
pub fn server_get_status(state: State<'_, AppState>) -> Result<ServerStatus, String> {
    state.status()
}

#[tauri::command]
pub fn server_get_config(state: State<'_, AppState>) -> Result<RedactedServerConfig, String> {
    state
        .config()
        .map(|config| RedactedServerConfig::from(&config))
}

#[tauri::command]
pub fn server_issue_local_session(state: State<'_, AppState>) -> Result<LocalSession, String> {
    let status = state.status()?;
    if !matches!(status.state, ServerState::Running) {
        return Err(status
            .error
            .unwrap_or_else(|| "the local workspace is not running".to_owned()));
    }
    let config = state.config()?;
    issue_local_session(status.port, &config.pin)
}

#[tauri::command]
pub fn server_get_network_info() -> Result<NetworkInfo, String> {
    let interfaces = if_addrs::get_if_addrs()
        .map_err(|error| format!("failed to enumerate network interfaces: {error}"))?;
    let mut addresses = interfaces
        .into_iter()
        .filter_map(|interface| {
            let ip = interface.ip();
            if !ip.is_ipv4() || ip.is_loopback() || ip.to_string().starts_with("169.254.") {
                return None;
            }
            Some(NetworkAddress {
                ip: ip.to_string(),
                name: interface.name,
                network_type: None,
            })
        })
        .collect::<Vec<_>>();
    addresses.sort_by(|left, right| left.name.cmp(&right.name).then(left.ip.cmp(&right.ip)));
    addresses.dedup_by(|left, right| left.ip == right.ip && left.name == right.name);
    Ok(NetworkInfo { addresses })
}

#[tauri::command]
pub fn server_update_config<R: Runtime>(
    updates: ServerConfigPatch,
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<LocalServerTransitionResult, String> {
    let autostart_update = updates.autostart_update();
    let local_server_update = updates.local_server_enabled;
    let previous_status = state.status()?;
    let (config, requires_restart) = state.update_config(updates)?;
    if let Some(enabled) = autostart_update {
        set_autostart(&app, enabled && config.local_server_enabled);
    }
    let status = if !config.local_server_enabled {
        if local_server_update == Some(false)
            || matches!(
                previous_status.state,
                ServerState::Running | ServerState::Starting
            )
        {
            state.stop_server(&app)?
        } else {
            previous_status.clone()
        }
    } else if requires_restart
        && matches!(
            previous_status.state,
            ServerState::Running | ServerState::Starting
        )
    {
        state.restart_server(&app)?
    } else if local_server_update == Some(true)
        || !matches!(
            previous_status.state,
            ServerState::Running | ServerState::Starting
        )
    {
        state.start_server(&app)?
    } else {
        previous_status.clone()
    };
    if local_server_update.is_some() && autostart_update.is_none() {
        set_autostart(&app, config.local_server_enabled && config.auto_start_host);
    }
    let result = transition_result(config, previous_status, status, requires_restart);
    let _ = app.emit("workspace-runtime-change", &result);
    Ok(result)
}

#[tauri::command]
pub fn server_select_folder<R: Runtime>(app: AppHandle<R>) -> Option<String> {
    app.dialog()
        .file()
        .blocking_pick_folder()
        .map(|path| path.to_string())
}

#[tauri::command]
pub fn server_open_obsidian_vault<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let config = state.config()?;
    if config.obsidian_vault_path.is_empty() {
        return Err("Obsidian vault path is not configured".to_owned());
    }
    let vault_name = std::path::Path::new(&config.obsidian_vault_path)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "configured Obsidian vault path has no valid folder name".to_owned())?;
    let mut url = url::Url::parse("obsidian://open")
        .map_err(|error| format!("failed to build Obsidian URL: {error}"))?;
    url.query_pairs_mut().append_pair("vault", vault_name);
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|error| format!("failed to open Obsidian vault: {error}"))
}

#[tauri::command]
pub fn server_open_log_folder<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve the log folder: {error}"))?;
    app.opener()
        .open_path(directory.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|error| format!("failed to open the log folder: {error}"))
}

#[tauri::command]
pub fn server_open_data_folder<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve the data folder: {error}"))?
        .join("server-data")
        .join("data");
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("failed to prepare the data folder: {error}"))?;
    app.opener()
        .open_path(directory.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|error| format!("failed to open the data folder: {error}"))
}

#[tauri::command]
pub fn server_set_app_mode<R: Runtime>(
    mode: AppMode,
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<LocalServerTransitionResult, String> {
    let previous_status = state.status()?;
    let config = state.set_app_mode(mode)?;
    let status = match mode {
        AppMode::Host if !matches!(previous_status.state, ServerState::Running) => {
            state.start_server(&app)?
        }
        // Client is now a compatibility marker for the selected workspace,
        // not an instruction to disconnect phones using this local server.
        _ => previous_status.clone(),
    };
    set_autostart(&app, config.local_server_enabled && config.auto_start_host);
    let result = transition_result(config, previous_status, status, false);
    let _ = app.emit("workspace-runtime-change", &result);
    Ok(result)
}

#[tauri::command]
pub fn server_get_app_mode(state: State<'_, AppState>) -> Result<AppMode, String> {
    Ok(state.config()?.app_mode)
}

fn set_autostart<R: Runtime>(app: &AppHandle<R>, enabled: bool) {
    let Some(manager) = app.try_state::<AutoLaunchManager>() else {
        startup_log::report("[clawchat] skipped system autostart update: plugin unavailable");
        return;
    };
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    if let Err(error) = result {
        startup_log::report(&format!(
            "[clawchat] failed to update system autostart: {error}"
        ));
    }
}

fn transition_result(
    config: ServerConfig,
    previous_status: ServerStatus,
    status: ServerStatus,
    restart_required: bool,
) -> LocalServerTransitionResult {
    let applied = if config.local_server_enabled {
        matches!(status.state, ServerState::Running)
    } else {
        matches!(status.state, ServerState::Stopped)
    };
    LocalServerTransitionResult {
        config: RedactedServerConfig::from(&config),
        previous_status,
        status,
        applied,
        restart_required,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_patch_detects_server_restart_fields() {
        assert!(ServerConfigPatch {
            port: Some(8123),
            ..ServerConfigPatch::default()
        }
        .requires_server_restart());
        assert!(!ServerConfigPatch {
            auto_start_host: Some(true),
            ..ServerConfigPatch::default()
        }
        .requires_server_restart());
        assert!(ServerConfigPatch {
            lan_access: Some(true),
            ..ServerConfigPatch::default()
        }
        .requires_server_restart());
    }

    #[test]
    fn transition_reports_a_saved_but_failed_server_start() {
        let result = transition_result(
            ServerConfig::default(),
            ServerStatus {
                state: ServerState::Stopped,
                port: 8000,
                pid: None,
                error: None,
            },
            ServerStatus {
                state: ServerState::Error,
                port: 8000,
                pid: None,
                error: Some("bind failed".to_owned()),
            },
            true,
        );

        assert!(!result.applied);
        assert!(result.restart_required);
        assert_eq!(result.status.error.as_deref(), Some("bind failed"));
    }
}
