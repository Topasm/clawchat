use std::{
    fs,
    path::{Path, PathBuf},
};

use atomicwrites::{AllowOverwrite, AtomicFile};
use serde::Serialize;

use crate::models::NativePaths;

const IMPORT_MARKER: &str = "electron-import-v1.json";

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub version: u8,
    pub source: String,
    pub config_imported: bool,
    pub data_imported: bool,
}

pub fn import_electron_data(
    paths: &NativePaths,
    candidates: &[PathBuf],
) -> Result<Option<ImportReport>, String> {
    let marker = paths.app_data_dir.join(IMPORT_MARKER);
    if marker.exists() {
        return Ok(None);
    }

    let Some(source) = candidates.iter().find(|candidate| {
        candidate.join("server-config.json").is_file()
            || candidate.join("server-data").join("data").is_dir()
    }) else {
        return Ok(None);
    };

    fs::create_dir_all(&paths.app_data_dir)
        .map_err(|error| format!("failed to create {}: {error}", paths.app_data_dir.display()))?;
    let mut report = ImportReport {
        version: 1,
        source: source.display().to_string(),
        ..ImportReport::default()
    };

    let source_config = source.join("server-config.json");
    if !paths.config_path.exists() && source_config.is_file() {
        let bytes = fs::read(&source_config).map_err(|error| {
            format!(
                "failed to read legacy config {}: {error}",
                source_config.display()
            )
        })?;
        serde_json::from_slice::<serde_json::Value>(&bytes).map_err(|error| {
            format!(
                "legacy config {} is invalid: {error}",
                source_config.display()
            )
        })?;
        atomic_write(&paths.config_path, &bytes)?;
        report.config_imported = true;
    }

    let source_data = source.join("server-data").join("data");
    if !has_entries(&paths.server_data_dir)? && source_data.is_dir() {
        let server_data_parent = paths
            .server_data_dir
            .parent()
            .ok_or_else(|| "server data directory has no parent".to_owned())?;
        fs::create_dir_all(server_data_parent).map_err(|error| {
            format!("failed to create {}: {error}", server_data_parent.display())
        })?;
        let temp = server_data_parent.join(format!(".electron-import-v1-{}", std::process::id()));
        if temp.exists() {
            fs::remove_dir_all(&temp).map_err(|error| {
                format!("failed to clear stale import {}: {error}", temp.display())
            })?;
        }
        copy_directory(&source_data, &temp).inspect_err(|_| {
            let _ = fs::remove_dir_all(&temp);
        })?;
        validate_sqlite_if_present(&temp).inspect_err(|_| {
            let _ = fs::remove_dir_all(&temp);
        })?;
        if paths.server_data_dir.exists() {
            fs::remove_dir(&paths.server_data_dir).map_err(|error| {
                format!(
                    "failed to replace empty data directory {}: {error}",
                    paths.server_data_dir.display()
                )
            })?;
        }
        fs::rename(&temp, &paths.server_data_dir).map_err(|error| {
            format!(
                "failed to atomically promote imported data {}: {error}",
                paths.server_data_dir.display()
            )
        })?;
        report.data_imported = true;
    }

    let payload = serde_json::to_vec_pretty(&report)
        .map_err(|error| format!("failed to serialize import marker: {error}"))?;
    atomic_write(&marker, &payload)?;
    Ok(Some(report))
}

fn has_entries(path: &Path) -> Result<bool, String> {
    if !path.exists() {
        return Ok(false);
    }
    let mut entries = fs::read_dir(path)
        .map_err(|error| format!("failed to inspect {}: {error}", path.display()))?;
    Ok(entries.next().is_some())
}

fn copy_directory(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("failed to create {}: {error}", destination.display()))?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("failed to read {}: {error}", source.display()))?
    {
        let entry = entry.map_err(|error| format!("failed to read directory entry: {error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            copy_directory(&source_path, &destination_path)?;
        } else {
            fs::copy(&source_path, &destination_path)
                .map_err(|error| format!("failed to copy {}: {error}", source_path.display()))?;
        }
    }
    Ok(())
}

fn validate_sqlite_if_present(data_dir: &Path) -> Result<(), String> {
    let database = data_dir.join("clawchat.db");
    if !database.exists() {
        return Ok(());
    }
    let bytes = fs::read(&database).map_err(|error| {
        format!(
            "failed to read imported database {}: {error}",
            database.display()
        )
    })?;
    validate_sqlite_structure(&bytes).map_err(|error| {
        format!(
            "imported database {} failed validation: {error}",
            database.display()
        )
    })?;
    Ok(())
}

fn validate_sqlite_structure(bytes: &[u8]) -> Result<(), &'static str> {
    if bytes.len() < 100 || &bytes[..16] != b"SQLite format 3\0" {
        return Err("missing SQLite 3 header");
    }
    let encoded_page_size = u16::from_be_bytes([bytes[16], bytes[17]]);
    let page_size = if encoded_page_size == 1 {
        65_536_usize
    } else {
        usize::from(encoded_page_size)
    };
    if !(512..=65_536).contains(&page_size) || !page_size.is_power_of_two() {
        return Err("invalid SQLite page size");
    }
    if !matches!(bytes[18], 1 | 2) || !matches!(bytes[19], 1 | 2) {
        return Err("invalid SQLite journal format");
    }
    if (bytes[21], bytes[22], bytes[23]) != (64, 32, 32) {
        return Err("invalid SQLite payload fractions");
    }
    if !bytes.len().is_multiple_of(page_size) {
        return Err("database length is not page aligned");
    }
    let declared_pages = u32::from_be_bytes([bytes[28], bytes[29], bytes[30], bytes[31]]) as usize;
    if declared_pages > 0 && bytes.len() < declared_pages.saturating_mul(page_size) {
        return Err("database is shorter than its declared page count");
    }
    Ok(())
}

fn atomic_write(path: &Path, payload: &[u8]) -> Result<(), String> {
    AtomicFile::new(path, AllowOverwrite)
        .write(|file| std::io::Write::write_all(file, payload))
        .map_err(|error| format!("failed to atomically write {}: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{models::AppMode, services::config::ConfigStore};

    fn paths(root: &Path) -> NativePaths {
        NativePaths {
            app_data_dir: root.to_owned(),
            config_path: root.join("server-config.json"),
            server_data_dir: root.join("server-data/data"),
            pid_path: root.join("server.pid"),
            resource_dir: root.join("resources"),
            development_server_dir: root.join("server"),
        }
    }

    fn write_sqlite_fixture(path: &Path) {
        let mut sqlite_page = vec![0_u8; 512];
        sqlite_page[..16].copy_from_slice(b"SQLite format 3\0");
        sqlite_page[16..18].copy_from_slice(&512_u16.to_be_bytes());
        sqlite_page[18] = 1;
        sqlite_page[19] = 1;
        sqlite_page[21..24].copy_from_slice(&[64, 32, 32]);
        sqlite_page[28..32].copy_from_slice(&1_u32.to_be_bytes());
        fs::write(path, sqlite_page).expect("database");
    }

    #[test]
    fn imports_valid_data_once_without_removing_source() {
        let source = tempfile::tempdir().expect("source");
        let destination = tempfile::tempdir().expect("destination");
        fs::create_dir_all(source.path().join("server-data/data/uploads")).expect("data dirs");
        fs::write(source.path().join("server-config.json"), r#"{"port":8000}"#).expect("config");
        let database = source.path().join("server-data/data/clawchat.db");
        write_sqlite_fixture(&database);
        fs::write(
            source.path().join("server-data/data/uploads/file.txt"),
            "keep",
        )
        .expect("upload");

        let native_paths = paths(destination.path());
        let first = import_electron_data(&native_paths, &[source.path().to_owned()])
            .expect("import")
            .expect("report");
        assert!(first.config_imported);
        assert!(first.data_imported);
        assert!(native_paths
            .server_data_dir
            .join("uploads/file.txt")
            .exists());
        assert!(database.exists());

        let second = import_electron_data(&native_paths, &[source.path().to_owned()])
            .expect("second import");
        assert!(second.is_none());
    }

    #[test]
    fn rejects_corrupt_database_before_promotion() {
        let source = tempfile::tempdir().expect("source");
        let destination = tempfile::tempdir().expect("destination");
        fs::create_dir_all(source.path().join("server-data/data")).expect("data dirs");
        fs::write(
            source.path().join("server-data/data/clawchat.db"),
            "not sqlite",
        )
        .expect("bad db");
        let native_paths = paths(destination.path());

        let error = import_electron_data(&native_paths, &[source.path().to_owned()])
            .expect_err("corrupt database must fail");
        assert!(error.contains("failed validation"));
        assert!(!native_paths.server_data_dir.exists());
        assert!(!native_paths.app_data_dir.join(IMPORT_MARKER).exists());
    }

    #[test]
    fn full_import_preserves_electron_source_for_rollback() {
        let source = tempfile::tempdir().expect("source");
        let destination = tempfile::tempdir().expect("destination");
        let source_data = source.path().join("server-data/data");
        fs::create_dir_all(source_data.join("uploads")).expect("data dirs");
        let source_config = source.path().join("server-config.json");
        fs::write(
            &source_config,
            r#"{
              "appMode": "host",
              "port": 8123,
              "pin": "654321",
              "obsidianVaultPath": "/vault/research",
              "hostServerUrl": "http://192.168.1.10:8123",
              "autoStartHost": true
            }"#,
        )
        .expect("config");
        let source_database = source_data.join("clawchat.db");
        let source_upload = source_data.join("uploads/paper.txt");
        write_sqlite_fixture(&source_database);
        fs::write(&source_upload, "electron-original").expect("upload");

        let original_config = fs::read(&source_config).expect("source config snapshot");
        let original_database = fs::read(&source_database).expect("source db snapshot");
        let original_upload = fs::read(&source_upload).expect("source upload snapshot");
        let native_paths = paths(destination.path());

        let report = import_electron_data(&native_paths, &[source.path().to_owned()])
            .expect("import")
            .expect("report");
        assert!(report.config_imported);
        assert!(report.data_imported);

        let imported_config = ConfigStore::new(native_paths.config_path.clone())
            .load()
            .expect("imported config");
        assert!(matches!(imported_config.app_mode, AppMode::Host));
        assert_eq!(imported_config.port, 8123);
        assert_eq!(imported_config.pin, "654321");
        assert_eq!(imported_config.obsidian_vault_path, "/vault/research");
        assert_eq!(imported_config.host_server_url, "http://192.168.1.10:8123");
        assert!(imported_config.auto_start_host);
        assert_eq!(
            fs::read(native_paths.server_data_dir.join("clawchat.db")).expect("imported db"),
            original_database
        );
        assert_eq!(
            fs::read(native_paths.server_data_dir.join("uploads/paper.txt"))
                .expect("imported upload"),
            original_upload
        );

        let marker: serde_json::Value = serde_json::from_slice(
            &fs::read(native_paths.app_data_dir.join(IMPORT_MARKER)).expect("marker"),
        )
        .expect("marker json");
        assert_eq!(marker["version"], 1);
        assert_eq!(marker["configImported"], true);
        assert_eq!(marker["dataImported"], true);

        fs::write(&native_paths.config_path, r#"{"appMode":"client"}"#)
            .expect("mutate Tauri config");
        fs::write(
            native_paths.server_data_dir.join("uploads/paper.txt"),
            "tauri-change",
        )
        .expect("mutate Tauri upload");

        assert_eq!(
            fs::read(&source_config).expect("rollback config"),
            original_config
        );
        assert_eq!(
            fs::read(&source_database).expect("rollback db"),
            original_database
        );
        assert_eq!(
            fs::read(&source_upload).expect("rollback upload"),
            original_upload
        );
    }

    #[test]
    fn import_never_overwrites_existing_tauri_data() {
        let source = tempfile::tempdir().expect("source");
        let destination = tempfile::tempdir().expect("destination");
        let source_data = source.path().join("server-data/data");
        fs::create_dir_all(&source_data).expect("source data");
        fs::write(source.path().join("server-config.json"), r#"{"port":8123}"#)
            .expect("source config");
        write_sqlite_fixture(&source_data.join("clawchat.db"));

        let native_paths = paths(destination.path());
        fs::create_dir_all(&native_paths.server_data_dir).expect("destination data");
        let existing_database = b"existing-tauri-database";
        fs::write(
            native_paths.server_data_dir.join("clawchat.db"),
            existing_database,
        )
        .expect("existing database");

        let report = import_electron_data(&native_paths, &[source.path().to_owned()])
            .expect("import")
            .expect("report");
        assert!(report.config_imported);
        assert!(!report.data_imported);
        assert_eq!(
            fs::read(native_paths.server_data_dir.join("clawchat.db")).expect("preserved database"),
            existing_database
        );
    }
}
