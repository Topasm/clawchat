//! Running work this machine was addressed for.

use crate::services::worker_cli::{self, WorkerRunRequest, WorkerRunResult};
use crate::services::worker_context::{self, ContextFile};

#[tauri::command]
pub async fn worker_run(request: WorkerRunRequest) -> Result<WorkerRunResult, String> {
    worker_cli::run(request).await
}

/// What a bound folder says about itself, for the server to keep.
#[tauri::command]
pub fn worker_read_context(path: String) -> Result<Vec<ContextFile>, String> {
    worker_context::read_context(&path)
}
