use std::{env, path::PathBuf};

use tauri::{AppHandle, Manager, Runtime};

use crate::models::NativePaths;

pub fn resolve_native_paths<R: Runtime>(app: &AppHandle<R>) -> Result<NativePaths, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve application data directory: {error}"))?;
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("failed to resolve resource directory: {error}"))?;
    let development_server_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| "failed to resolve repository root".to_owned())?
        .join("server");

    Ok(NativePaths {
        config_path: app_data_dir.join("server-config.json"),
        server_data_dir: app_data_dir.join("server-data").join("data"),
        pid_path: app_data_dir.join("server.pid"),
        app_data_dir,
        resource_dir,
        development_server_dir,
    })
}

pub fn electron_user_data_candidates(destination: &std::path::Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(explicit) = env::var_os("CLAWCHAT_ELECTRON_USER_DATA") {
        candidates.push(PathBuf::from(explicit));
    }
    if let Some(config_dir) = dirs::config_dir() {
        candidates.push(config_dir.join("ClawChat"));
        candidates.push(config_dir.join("clawchat"));
    }
    if let Some(data_dir) = dirs::data_dir() {
        candidates.push(data_dir.join("ClawChat"));
        candidates.push(data_dir.join("clawchat"));
    }

    let mut unique = Vec::new();
    for candidate in candidates {
        if candidate != destination && !unique.contains(&candidate) {
            unique.push(candidate);
        }
    }
    unique
}
