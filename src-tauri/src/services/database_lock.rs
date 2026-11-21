// Which process serves a workspace's database (ADR 021).
//
// The server takes an exclusive OS lock on `<db>.lock` before it touches the
// database and records who it is in `<db>.owner.json`
// (`server/services/database_lock.py`). The desktop shell reads the same pair
// to connect to a server that is already running instead of starting a
// second one, and the headless `--server-only` launcher waits on it until the
// database is free.

use std::{
    fs::{self, OpenOptions, TryLockError},
    path::{Path, PathBuf},
};

use serde::Deserialize;

/// Printed by a server that found the database already claimed. Must match
/// `IN_USE_MARKER` in `server/services/database_lock.py`.
pub const DATABASE_IN_USE_MARKER: &str = "ClawChat database in use";

/// `SERVER_OWNER` for a server this app starts and stops with its window.
pub const OWNER_DESKTOP: &str = "desktop";
/// `SERVER_OWNER` for a server run by the `--server-only` service.
pub const OWNER_SERVICE: &str = "service";

/// The parts of `<db>.owner.json` the shell acts on; the server also records
/// its bind host, version and start time for people reading the file.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct DatabaseOwner {
    pub pid: u32,
    pub port: u16,
    #[serde(default)]
    pub owner: String,
}

impl DatabaseOwner {
    pub fn started_by_desktop(&self) -> bool {
        self.owner == OWNER_DESKTOP
    }

    pub fn describe(&self) -> String {
        let started_by = match self.owner.as_str() {
            OWNER_DESKTOP => "the desktop app",
            OWNER_SERVICE => "the server-only service",
            "" => "an unknown launcher",
            other => other,
        };
        format!(
            "pid {}, port {}, started by {started_by}",
            self.pid, self.port
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DatabaseHolder {
    Free,
    Held,
}

pub fn lock_path(database: &Path) -> PathBuf {
    with_suffix(database, ".lock")
}

pub fn owner_path(database: &Path) -> PathBuf {
    with_suffix(database, ".owner.json")
}

/// Whether a live process holds the database's lock right now.
///
/// The probe takes the lock for an instant when it is free, so a server
/// starting at that very moment can lose its own claim and exit; whoever
/// started it (the shell, or systemd) then finds the database held.
pub fn probe(database: &Path) -> Result<DatabaseHolder, String> {
    let lock = lock_path(database);
    if !lock.parent().is_some_and(Path::is_dir) {
        return Ok(DatabaseHolder::Free);
    }
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&lock)
        .map_err(|error| format!("failed to open {}: {error}", lock.display()))?;
    match file.try_lock() {
        Ok(()) => {
            let _ = file.unlock();
            Ok(DatabaseHolder::Free)
        }
        Err(TryLockError::WouldBlock) => Ok(DatabaseHolder::Held),
        Err(TryLockError::Error(error)) => {
            Err(format!("failed to inspect {}: {error}", lock.display()))
        }
    }
}

/// Who last claimed the database. Only current while [`probe`] says `Held`.
pub fn read_owner(database: &Path) -> Option<DatabaseOwner> {
    let bytes = fs::read(owner_path(database)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn with_suffix(database: &Path, suffix: &str) -> PathBuf {
    let mut name = database.file_name().unwrap_or_default().to_os_string();
    name.push(suffix);
    database.with_file_name(name)
}

#[cfg(test)]
mod tests {
    use std::fs::File;

    use super::*;

    #[test]
    fn lock_and_owner_files_sit_beside_the_database() {
        let database = Path::new("/data/server-data/data/clawchat.db");

        assert_eq!(
            lock_path(database),
            Path::new("/data/server-data/data/clawchat.db.lock")
        );
        assert_eq!(
            owner_path(database),
            Path::new("/data/server-data/data/clawchat.db.owner.json")
        );
    }

    #[test]
    fn a_missing_data_directory_means_nobody_serves_it() {
        let root = tempfile::tempdir().expect("temp dir");

        let holder = probe(&root.path().join("missing/clawchat.db")).expect("probe");

        assert_eq!(holder, DatabaseHolder::Free);
    }

    #[test]
    fn a_held_lock_reports_the_database_as_held() {
        let root = tempfile::tempdir().expect("temp dir");
        let database = root.path().join("clawchat.db");
        let holder = File::create(lock_path(&database)).expect("lock file");
        holder.lock().expect("hold lock");

        assert_eq!(probe(&database).expect("probe"), DatabaseHolder::Held);

        holder.unlock().expect("release lock");
        assert_eq!(probe(&database).expect("probe"), DatabaseHolder::Free);
    }

    #[test]
    fn probing_a_free_database_leaves_it_free() {
        let root = tempfile::tempdir().expect("temp dir");
        let database = root.path().join("clawchat.db");

        assert_eq!(probe(&database).expect("probe"), DatabaseHolder::Free);
        let claimant = File::open(lock_path(&database)).expect("lock file");
        claimant.try_lock().expect("probe released its lock");
    }

    #[test]
    fn reads_the_owner_record_the_server_writes() {
        let root = tempfile::tempdir().expect("temp dir");
        let database = root.path().join("clawchat.db");
        fs::write(
            owner_path(&database),
            r#"{"pid": 4242, "host": "0.0.0.0", "port": 8000, "owner": "service",
                "version": "1.4.60", "started_at": "2026-11-21T12:00:00+00:00"}"#,
        )
        .expect("owner record");

        let owner = read_owner(&database).expect("owner");

        assert_eq!(owner.pid, 4242);
        assert_eq!(owner.port, 8000);
        assert!(!owner.started_by_desktop());
        assert_eq!(
            owner.describe(),
            "pid 4242, port 8000, started by the server-only service"
        );
    }

    #[test]
    fn a_damaged_owner_record_reads_as_unknown() {
        let root = tempfile::tempdir().expect("temp dir");
        let database = root.path().join("clawchat.db");
        fs::write(owner_path(&database), "{not json").expect("owner record");

        assert_eq!(read_owner(&database), None);
    }
}
