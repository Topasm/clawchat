use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex, MutexGuard,
};

use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_updater::Update;

use crate::{
    models::{AppMode, ServerConfig, ServerConfigPatch, ServerState, ServerStatus},
    services::{
        config::ConfigStore,
        migration::import_electron_data,
        paths::{electron_user_data_candidates, resolve_native_paths},
        server_supervisor::ServerSupervisor,
    },
    startup_log,
};

pub struct AppState {
    config: Mutex<ServerConfig>,
    config_store: ConfigStore,
    supervisor: Mutex<ServerSupervisor>,
    migration_error: Option<String>,
}

pub struct PendingUpdateState {
    inner: Mutex<PendingUpdate>,
    operation_active: AtomicBool,
}

impl Default for PendingUpdateState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(PendingUpdate::default()),
            operation_active: AtomicBool::new(false),
        }
    }
}

#[derive(Default)]
struct PendingUpdate {
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
}

impl PendingUpdateState {
    pub(crate) fn begin_operation(&self) -> Result<PendingUpdateOperation<'_>, String> {
        self.operation_active
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .map_err(|_| "another updater operation is already running".to_owned())?;
        Ok(PendingUpdateOperation {
            active: &self.operation_active,
        })
    }

    pub fn clear(&self) -> Result<(), String> {
        *self.lock()? = PendingUpdate::default();
        Ok(())
    }

    pub fn set_update(&self, update: Update) -> Result<(), String> {
        *self.lock()? = PendingUpdate {
            update: Some(update),
            bytes: None,
        };
        Ok(())
    }

    pub fn update(&self) -> Result<Update, String> {
        self.lock()?
            .update
            .clone()
            .ok_or_else(|| "no checked update is available".to_owned())
    }

    pub fn set_download(&self, bytes: Vec<u8>) -> Result<(), String> {
        let mut pending = self.lock()?;
        if pending.update.is_none() {
            return Err("update metadata was cleared during download".to_owned());
        }
        pending.bytes = Some(bytes);
        Ok(())
    }

    pub fn take_download(&self) -> Result<(Update, Vec<u8>), String> {
        let mut pending = self.lock()?;
        if pending.update.is_none() {
            return Err("no checked update is available".to_owned());
        }
        if pending.bytes.is_none() {
            return Err("update has not been downloaded".to_owned());
        }
        Ok((
            pending.update.take().expect("checked above"),
            pending.bytes.take().expect("checked above"),
        ))
    }

    pub fn restore_download(&self, update: Update, bytes: Vec<u8>) -> Result<(), String> {
        *self.lock()? = PendingUpdate {
            update: Some(update),
            bytes: Some(bytes),
        };
        Ok(())
    }

    pub fn ready_update(&self) -> Result<Option<Update>, String> {
        let pending = self.lock()?;
        Ok(pending
            .bytes
            .as_ref()
            .and_then(|_| pending.update.as_ref().cloned()))
    }

    fn lock(&self) -> Result<MutexGuard<'_, PendingUpdate>, String> {
        self.inner
            .lock()
            .map_err(|_| "pending update lock is poisoned".to_owned())
    }
}

pub(crate) struct PendingUpdateOperation<'a> {
    active: &'a AtomicBool,
}

impl Drop for PendingUpdateOperation<'_> {
    fn drop(&mut self) {
        self.active.store(false, Ordering::Release);
    }
}

impl AppState {
    pub fn initialize<R: Runtime>(app: &AppHandle<R>) -> Result<Self, String> {
        let paths = resolve_native_paths(app)?;
        let candidates = electron_user_data_candidates(&paths.app_data_dir);
        let migration_error = import_electron_data(&paths, &candidates).err();
        let config_store = ConfigStore::new(paths.config_path.clone());
        let (config, config_error) = match config_store.load() {
            Ok(config) => (config, None),
            Err(error) => (ServerConfig::default(), Some(error)),
        };
        let migration_error = migration_error.or(config_error);
        let supervisor = ServerSupervisor::new(paths, config.port);
        Ok(Self {
            config: Mutex::new(config),
            config_store,
            supervisor: Mutex::new(supervisor),
            migration_error,
        })
    }

    pub fn config(&self) -> Result<ServerConfig, String> {
        Ok(self.lock_config()?.clone())
    }

    pub fn update_config(&self, patch: ServerConfigPatch) -> Result<(ServerConfig, bool), String> {
        let restart = patch.requires_server_restart();
        let mut config = self.lock_config()?;
        patch.apply(&mut config);
        self.config_store.save(&config)?;
        Ok((config.clone(), restart))
    }

    pub fn set_app_mode(&self, mode: AppMode) -> Result<ServerConfig, String> {
        let mut config = self.lock_config()?;
        config.app_mode = mode;
        self.config_store.save(&config)?;
        Ok(config.clone())
    }

    pub fn status(&self) -> Result<ServerStatus, String> {
        Ok(self.lock_supervisor()?.status())
    }

    pub fn start_server<R: Runtime>(&self, app: &AppHandle<R>) -> Result<ServerStatus, String> {
        let config = self.config()?;
        let status = if let Some(error) = &self.migration_error {
            ServerStatus {
                state: ServerState::Error,
                port: config.port,
                pid: None,
                error: Some(format!(
                    "legacy data import failed; host startup blocked: {error}"
                )),
            }
        } else {
            emit_status(
                app,
                &ServerStatus {
                    state: ServerState::Starting,
                    port: config.port,
                    pid: None,
                    error: None,
                },
            );
            self.lock_supervisor()?.start(&config)
        };
        emit_status(app, &status);
        Ok(status)
    }

    pub fn stop_server<R: Runtime>(&self, app: &AppHandle<R>) -> Result<ServerStatus, String> {
        let status = self.lock_supervisor()?.stop();
        emit_status(app, &status);
        Ok(status)
    }

    pub fn restart_server<R: Runtime>(&self, app: &AppHandle<R>) -> Result<ServerStatus, String> {
        let config = self.config()?;
        let status = if let Some(error) = &self.migration_error {
            ServerStatus {
                state: ServerState::Error,
                port: config.port,
                pid: None,
                error: Some(format!(
                    "legacy data import failed; host startup blocked: {error}"
                )),
            }
        } else {
            emit_status(
                app,
                &ServerStatus {
                    state: ServerState::Starting,
                    port: config.port,
                    pid: None,
                    error: None,
                },
            );
            self.lock_supervisor()?.restart(&config)
        };
        emit_status(app, &status);
        Ok(status)
    }

    pub fn should_start_host(&self) -> bool {
        self.config()
            .map(|config| matches!(config.app_mode, AppMode::Host))
            .unwrap_or(false)
    }

    fn lock_config(&self) -> Result<MutexGuard<'_, ServerConfig>, String> {
        self.config
            .lock()
            .map_err(|_| "server configuration lock is poisoned".to_owned())
    }

    fn lock_supervisor(&self) -> Result<MutexGuard<'_, ServerSupervisor>, String> {
        self.supervisor
            .lock()
            .map_err(|_| "server supervisor lock is poisoned".to_owned())
    }
}

fn emit_status<R: Runtime>(app: &AppHandle<R>, status: &ServerStatus) {
    if let Err(error) = app.emit("server-status-change", status) {
        startup_log::report(&format!("[clawchat] failed to emit server status: {error}"));
    }
}
