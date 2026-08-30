use std::path::PathBuf;

use serde::{Deserialize, Serialize};

const DEFAULT_PIN: &str = "123456";

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AppMode {
    Client,
    /// A fresh install runs its own bundled server so the desktop app is
    /// usable offline, with no pairing step. Client mode is an explicit
    /// opt-in for "connect to a server running on another machine".
    #[default]
    Host,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct ServerConfig {
    pub app_mode: AppMode,
    pub local_server_enabled: bool,
    pub keep_running_in_tray: bool,
    pub port: u16,
    pub pin: String,
    pub obsidian_vault_path: String,
    pub host_server_url: String,
    pub auto_start_host: bool,
    pub lan_access: bool,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            app_mode: AppMode::Host,
            local_server_enabled: true,
            keep_running_in_tray: true,
            port: 8000,
            pin: DEFAULT_PIN.to_owned(),
            obsidian_vault_path: String::new(),
            host_server_url: String::new(),
            auto_start_host: false,
            lan_access: false,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedactedServerConfig {
    pub app_mode: AppMode,
    pub local_server_enabled: bool,
    pub keep_running_in_tray: bool,
    pub port: u16,
    pub pin_configured: bool,
    pub default_pin_in_use: bool,
    pub obsidian_vault_path: String,
    pub host_server_url: String,
    pub auto_start_host: bool,
    pub lan_access: bool,
}

impl From<&ServerConfig> for RedactedServerConfig {
    fn from(config: &ServerConfig) -> Self {
        Self {
            app_mode: config.app_mode,
            local_server_enabled: config.local_server_enabled,
            keep_running_in_tray: config.keep_running_in_tray,
            port: config.port,
            pin_configured: !config.pin.is_empty(),
            default_pin_in_use: config.pin == DEFAULT_PIN,
            obsidian_vault_path: config.obsidian_vault_path.clone(),
            host_server_url: config.host_server_url.clone(),
            auto_start_host: config.auto_start_host,
            lan_access: config.lan_access,
        }
    }
}

impl ServerConfig {
    pub fn bind_host(&self) -> &'static str {
        if self.lan_access {
            "0.0.0.0"
        } else {
            "127.0.0.1"
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if !self.pin.bytes().all(|byte| byte.is_ascii_digit())
            || !(6..=32).contains(&self.pin.len())
        {
            return Err("PIN must contain between 6 and 32 digits".to_owned());
        }
        if self.lan_access && self.pin == DEFAULT_PIN {
            return Err("Change the default PIN before enabling LAN access".to_owned());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerConfigPatch {
    pub app_mode: Option<AppMode>,
    pub local_server_enabled: Option<bool>,
    pub keep_running_in_tray: Option<bool>,
    pub port: Option<u16>,
    pub pin: Option<String>,
    pub obsidian_vault_path: Option<String>,
    pub host_server_url: Option<String>,
    pub auto_start_host: Option<bool>,
    pub lan_access: Option<bool>,
}

impl ServerConfigPatch {
    pub fn autostart_update(&self) -> Option<bool> {
        self.auto_start_host
    }

    pub fn requires_server_restart(&self) -> bool {
        self.port.is_some()
            || self.pin.is_some()
            || self.obsidian_vault_path.is_some()
            || self.lan_access.is_some()
    }

    pub fn apply(self, config: &mut ServerConfig) {
        if let Some(value) = self.app_mode {
            config.app_mode = value;
        }
        if let Some(value) = self.local_server_enabled {
            config.local_server_enabled = value;
        }
        if let Some(value) = self.keep_running_in_tray {
            config.keep_running_in_tray = value;
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
        if let Some(value) = self.lan_access {
            config.lan_access = value;
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
pub struct LocalServerTransitionResult {
    pub config: RedactedServerConfig,
    pub previous_status: ServerStatus,
    pub status: ServerStatus,
    pub applied: bool,
    pub restart_required: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct LocalSession {
    pub access_token: String,
    pub refresh_token: Option<String>,
}

impl ServerStatus {
    /// Describe a startup outcome that left the sidecar unusable, or `None`
    /// when the server came up.
    ///
    /// A blocked host start (a failed legacy import, a missing server binary,
    /// a health check that never passed) is reported as an `Error` *status*,
    /// not as an `Err`, so callers that only inspect the `Result` see nothing
    /// at all. This is what they should ask instead.
    pub fn startup_failure(&self) -> Option<String> {
        match self.state {
            ServerState::Running | ServerState::Starting => None,
            ServerState::Stopped => Some(
                self.error
                    .clone()
                    .unwrap_or_else(|| "server stopped without starting".to_owned()),
            ),
            ServerState::Error => Some(
                self.error
                    .clone()
                    .unwrap_or_else(|| "server reported an unspecified failure".to_owned()),
            ),
        }
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn status(state: ServerState, error: Option<&str>) -> ServerStatus {
        ServerStatus {
            state,
            port: 8000,
            pid: None,
            error: error.map(str::to_owned),
        }
    }

    #[test]
    fn running_and_starting_hosts_are_not_startup_failures() {
        assert!(status(ServerState::Running, None)
            .startup_failure()
            .is_none());
        assert!(status(ServerState::Starting, None)
            .startup_failure()
            .is_none());
    }

    #[test]
    fn blocked_startup_reports_the_underlying_reason() {
        assert_eq!(
            status(
                ServerState::Error,
                Some("legacy data import failed; host startup blocked: db is corrupt"),
            )
            .startup_failure(),
            Some("legacy data import failed; host startup blocked: db is corrupt".to_owned())
        );
    }

    #[test]
    fn failed_startup_without_a_reason_still_reports_something() {
        assert_eq!(
            status(ServerState::Error, None).startup_failure(),
            Some("server reported an unspecified failure".to_owned())
        );
        assert_eq!(
            status(ServerState::Stopped, None).startup_failure(),
            Some("server stopped without starting".to_owned())
        );
    }

    #[test]
    fn local_workspace_binds_only_to_loopback_by_default() {
        let config = ServerConfig::default();

        assert_eq!(config.bind_host(), "127.0.0.1");
        assert!(config.local_server_enabled);
        assert!(config.keep_running_in_tray);
        assert!(!config.lan_access);
        assert!(config.validate().is_ok());
    }

    #[test]
    fn renderer_config_never_contains_the_local_pin() {
        let config = ServerConfig {
            pin: "938274".to_owned(),
            ..ServerConfig::default()
        };

        let serialized =
            serde_json::to_string(&RedactedServerConfig::from(&config)).expect("redacted config");

        assert!(!serialized.contains("938274"));
        assert!(serialized.contains("\"pinConfigured\":true"));
        assert!(serialized.contains("\"defaultPinInUse\":false"));
    }

    #[test]
    fn lan_access_requires_a_non_default_numeric_pin() {
        let mut config = ServerConfig {
            lan_access: true,
            ..ServerConfig::default()
        };

        assert_eq!(config.bind_host(), "0.0.0.0");
        assert_eq!(
            config.validate(),
            Err("Change the default PIN before enabling LAN access".to_owned())
        );

        config.pin = "938274".to_owned();
        assert!(config.validate().is_ok());
        config.pin = "not-a-pin".to_owned();
        assert_eq!(
            config.validate(),
            Err("PIN must contain between 6 and 32 digits".to_owned())
        );
    }
}
