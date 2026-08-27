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
        let mut config: ServerConfig = serde_json::from_value(value)
            .map_err(|error| format!("invalid server config {}: {error}", self.path.display()))?;

        if was_legacy_host {
            config.app_mode = crate::models::AppMode::Host;
            config.auto_start_host = true;
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
            .map_err(|error| format!("failed to atomically save {}: {error}", self.path.display()))
    }

    #[cfg(test)]
    pub fn path(&self) -> &std::path::Path {
        &self.path
    }
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
        assert!(config.auto_start_host);
        assert_eq!(config.port, 8123);

        let persisted = fs::read_to_string(store.path()).expect("persisted config");
        assert!(persisted.contains("\"appMode\": \"host\""));
    }
}
