//! Running work this machine was addressed for.

use crate::services::worker_cli::{self, WorkerRunRequest, WorkerRunResult};
use crate::services::worker_context::{self, ContextFile};
use crate::services::worker_source::{self, IndexFile, SourceAnswer, SourceQuery};

#[tauri::command]
pub async fn worker_run(request: WorkerRunRequest) -> Result<WorkerRunResult, String> {
    worker_cli::run(request).await
}

/// What a bound folder says about itself, for the server to keep.
#[tauri::command]
pub fn worker_read_context(path: String) -> Result<Vec<ContextFile>, String> {
    worker_context::read_context(&path)
}

/// Answer another device's request for a folder this machine offers.
///
/// Walking a vault can take a moment, so it runs off the main thread.
#[tauri::command]
pub async fn worker_query_source(request: SourceQuery) -> Result<SourceAnswer, String> {
    tauri::async_runtime::spawn_blocking(move || worker_source::query(&request))
        .await
        .map_err(|error| format!("Could not read the source: {error}"))
}

/// Names and dates of the shared files, for Home to show while this machine is off.
#[tauri::command]
pub async fn worker_index_source(
    root: String,
    include_folders: Vec<String>,
    exclude_folders: Vec<String>,
) -> Result<Vec<IndexFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        worker_source::index(&root, &include_folders, &exclude_folders)
    })
    .await
    .map_err(|error| format!("Could not index the source: {error}"))?
}
