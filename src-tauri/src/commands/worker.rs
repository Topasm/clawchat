//! Running work this machine was addressed for.

use crate::services::worker_cli::{self, WorkerRunRequest, WorkerRunResult};

#[tauri::command]
pub async fn worker_run(request: WorkerRunRequest) -> Result<WorkerRunResult, String> {
    worker_cli::run(request).await
}
