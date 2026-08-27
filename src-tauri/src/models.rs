use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AppMode {
    #[default]
    Client,
    Host,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct ServerConfig {
    pub app_mode: AppMode,
    pub port: u16,
    pub pin: String,
    pub obsidian_vault_path: String,
    pub host_server_url: String,
    pub auto_start_host: bool,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            app_mode: AppMode::Client,
            port: 8000,
            pin: "123456".to_owned(),
            obsidian_vault_path: String::new(),
            host_server_url: String::new(),
            auto_start_host: false,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerConfigPatch {
    pub app_mode: Option<AppMode>,
    pub port: Option<u16>,
    pub pin: Option<String>,
    pub obsidian_vault_path: Option<String>,
    pub host_server_url: Option<String>,
    pub auto_start_host: Option<bool>,
}

impl ServerConfigPatch {
    pub fn autostart_update(&self) -> Option<bool> {
        self.auto_start_host
    }

    pub fn requires_server_restart(&self) -> bool {
        self.port.is_some() || self.pin.is_some() || self.obsidian_vault_path.is_some()
    }

    pub fn apply(self, config: &mut ServerConfig) {
        if let Some(value) = self.app_mode {
            config.app_mode = value;
        }
        if let Some(value) = self.port {
            config.port = value;
        }
        if let Some(value) = self.pin {
            config.pin = value;
        }
        if let Some(value) = self.obsidian_vault_path {
            config.obsidian_vault_path = value;
        }
        if let Some(value) = self.host_server_url {
            config.host_server_url = value;
        }
        if let Some(value) = self.auto_start_host {
            config.auto_start_host = value;
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ServerState {
    Starting,
    Running,
    #[default]
    Stopped,
    Error,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub state: ServerState,
    pub port: u16,
    pub pid: Option<u32>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkAddress {
    pub ip: String,
    pub name: String,
    pub network_type: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct NetworkInfo {
    pub addresses: Vec<NetworkAddress>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub release_notes: Option<String>,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDownloadProgress {
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub percent: Option<f64>,
}

#[derive(Clone, Debug)]
pub struct NativePaths {
    pub app_data_dir: PathBuf,
    pub config_path: PathBuf,
    pub server_data_dir: PathBuf,
    pub pid_path: PathBuf,
    pub resource_dir: PathBuf,
    pub development_server_dir: PathBuf,
}
