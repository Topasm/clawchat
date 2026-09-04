fn main() {
    const COMMANDS: &[&str] = &[
        "server_get_status",
        "server_get_config",
        "server_issue_local_session",
        "server_get_network_info",
        "server_update_config",
        "server_select_folder",
        "server_open_obsidian_vault",
        "server_open_log_folder",
        "server_open_data_folder",
        "server_set_app_mode",
        "server_get_app_mode",
        "app_show_notification",
        "app_set_badge_count",
        "app_open_camera_settings",
        "app_open_canonical_document",
        "app_set_workspace_view_mode",
        "secure_storage_get",
        "secure_storage_set",
        "secure_storage_remove",
        "updater_check",
        "updater_download",
        "updater_install",
        "worker_run",
        "worker_read_context",
    ];

    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to build Tauri command permissions");
}
