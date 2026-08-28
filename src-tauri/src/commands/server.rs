use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_autostart::AutoLaunchManager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::{
    models::{AppMode, NetworkAddress, NetworkInfo, ServerConfig, ServerConfigPatch, ServerStatus},
    startup_log,
    state::AppState,
};

#[tauri::command]
pub fn server_get_status(state: State<'_, AppState>) -> Result<ServerStatus, String> {
    state.status()
}

#[tauri::command]
pub fn server_get_config(state: State<'_, AppState>) -> Result<ServerConfig, String> {
    state.config()
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
) -> Result<ServerConfig, String> {
    let autostart_update = updates.autostart_update();
    let (config, requires_restart) = state.update_config(updates)?;
    if let Some(enabled) = autostart_update {
        set_autostart(&app, enabled && matches!(config.app_mode, AppMode::Host));
    }
    if requires_restart && matches!(config.app_mode, AppMode::Host) {
        state.restart_server(&app)?;
    }
    Ok(config)
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
pub fn server_set_app_mode<R: Runtime>(
    mode: AppMode,
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<ServerConfig, String> {
    let config = state.set_app_mode(mode)?;
    match mode {
        AppMode::Host => {
            state.start_server(&app)?;
            set_autostart(&app, config.auto_start_host);
        }
        AppMode::Client => {
            state.stop_server(&app)?;
            set_autostart(&app, false);
        }
    }
    Ok(config)
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
    }
}
