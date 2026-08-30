use std::{fs, path::PathBuf};

use atomicwrites::{AllowOverwrite, AtomicFile};
use serde_json::Value;

use crate::models::ServerConfig;

#[derive(Clone, Debug)]
pub struct ConfigStore {
    path: PathBuf,
}

impl ConfigStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn load(&self) -> Result<ServerConfig, String> {
        if !self.path.exists() {
            return Ok(ServerConfig::default());
        }

        let bytes = fs::read(&self.path)
            .map_err(|error| format!("failed to read {}: {error}", self.path.display()))?;
        let value: Value = serde_json::from_slice(&bytes)
            .map_err(|error| format!("invalid server config {}: {error}", self.path.display()))?;
        let was_legacy_host = value.get("appMode").is_none()
            && (value.get("port").is_some() || value.get("pin").is_some());
        let needs_policy_migration = value.get("localServerEnabled").is_none();
        let legacy_mode_was_host = value
            .get("appMode")
            .and_then(Value::as_str)
            .map(|mode| mode == "host")
            .unwrap_or(was_legacy_host);
        let mut config: ServerConfig = serde_json::from_value(value)
            .map_err(|error| format!("invalid server config {}: {error}", self.path.display()))?;

        if was_legacy_host {
            config.app_mode = crate::models::AppMode::Host;
            config.auto_start_host = true;
        }
        if needs_policy_migration {
            // Before policy and workspace selection were separated, Client
            // mode always meant that the local sidecar was disabled. Preserve
            // that explicit choice while fresh installs keep the local-first
            // default from `ServerConfig::default`.
            config.local_server_enabled = legacy_mode_was_host;
            config.keep_running_in_tray = legacy_mode_was_host;
        }
        if was_legacy_host || needs_policy_migration {
            self.save(&config)?;
        }

        Ok(config)
    }

    pub fn save(&self, config: &ServerConfig) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
        }
        let payload = serde_json::to_vec_pretty(config)
            .map_err(|error| format!("failed to serialize server config: {error}"))?;
        AtomicFile::new(&self.path, AllowOverwrite)
            .write(|file| std::io::Write::write_all(file, &payload))
            .map_err(|error| {
                format!("failed to atomically save {}: {error}", self.path.display())
            })?;
        restrict_config_permissions(&self.path)
    }

    /// Preserve an unreadable config for diagnostics and replace it with a
    /// host-mode default.  A malformed preference file must not make the
    /// user's local tasks and calendar inaccessible.
    pub fn recover_default(&self) -> Result<ServerConfig, String> {
        if self.path.exists() {
            let backup = self.path.with_extension("invalid.json");
            fs::copy(&self.path, &backup).map_err(|error| {
                format!(
                    "failed to preserve invalid config {} as {}: {error}",
                    self.path.display(),
                    backup.display()
                )
            })?;
        }
        let config = ServerConfig::default();
        self.save(&config)?;
        Ok(config)
    }

    #[cfg(test)]
    pub fn path(&self) -> &std::path::Path {
        &self.path
    }
}

#[cfg(unix)]
fn restrict_config_permissions(path: &std::path::Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("failed to protect {}: {error}", path.display()))
}

#[cfg(not(unix))]
fn restrict_config_permissions(_path: &std::path::Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::AppMode;

    #[test]
    fn persists_config_and_migrates_legacy_host_shape() {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = ConfigStore::new(dir.path().join("server-config.json"));
        fs::write(store.path(), r#"{"port":8123,"pin":"654321"}"#).expect("legacy config");

        let config = store.load().expect("load config");
        assert!(matches!(config.app_mode, AppMode::Host));
        assert!(config.local_server_enabled);
        assert!(config.auto_start_host);
        assert_eq!(config.port, 8123);

        let persisted = fs::read_to_string(store.path()).expect("persisted config");
        assert!(persisted.contains("\"appMode\": \"host\""));
    }

    #[test]
    fn fresh_install_defaults_to_local_host_mode() {
        // A first launch has no config file. It must come up as its own host so
        // the app is usable immediately, without pairing to a remote server.
        let dir = tempfile::tempdir().expect("temp dir");
        let store = ConfigStore::new(dir.path().join("server-config.json"));

        let config = store.load().expect("load config");

        assert!(matches!(config.app_mode, AppMode::Host));
        assert!(config.local_server_enabled);
        // Running our own server must not also enrol the app in OS autostart:
        // that stays an explicit opt-in.
        assert!(!config.auto_start_host);
    }

    #[cfg(unix)]
    #[test]
    fn persisted_pin_configuration_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().expect("temp dir");
        let store = ConfigStore::new(dir.path().join("server-config.json"));

        store.save(&ServerConfig::default()).expect("save config");

        let mode = fs::metadata(store.path())
            .expect("config metadata")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn explicit_client_mode_is_preserved() {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = ConfigStore::new(dir.path().join("server-config.json"));
        fs::write(store.path(), r#"{"appMode":"client","port":8000}"#).expect("client config");

        let config = store.load().expect("load config");

        assert!(matches!(config.app_mode, AppMode::Client));
        assert!(!config.local_server_enabled);
        assert!(!config.keep_running_in_tray);

        let persisted = fs::read_to_string(store.path()).expect("migrated config");
        assert!(persisted.contains("\"localServerEnabled\": false"));
    }

    #[test]
    fn malformed_config_is_preserved_and_replaced_with_local_defaults() {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = ConfigStore::new(dir.path().join("server-config.json"));
        fs::write(store.path(), "{not-json").expect("invalid config");

        assert!(store.load().is_err());
        let recovered = store.recover_default().expect("recover config");

        assert!(matches!(recovered.app_mode, AppMode::Host));
        assert_eq!(
            fs::read_to_string(dir.path().join("server-config.invalid.json"))
                .expect("preserved config"),
            "{not-json"
        );
        assert!(store.load().is_ok());
    }
}
