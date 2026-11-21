// `clawchat-tauri --server-only`: the bundled server without a window (ADR 021).
//
// A host-mode desktop app serves phones and workers only while someone is
// logged in, because its window owns the server. This mode runs the same
// server, with the same settings, PIN and data folder, so a systemd user
// service can keep the machine serving from boot. It returns before Tauri is
// built, so it never opens a window, touches GTK or needs a desktop session.

use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::Duration,
};

use crate::{
    models::NativePaths,
    services::{
        config::ConfigStore,
        database_lock::{self, DatabaseHolder},
        server_supervisor::ServerSupervisor,
    },
};

pub const SERVER_ONLY_FLAG: &str = "--server-only";
const DATA_DIR_FLAG: &str = "--data-dir";
/// `identifier` in tauri.conf.json, which names the app's data folder.
const APP_IDENTIFIER: &str = "com.clawchat.desktop";
/// `productName` in tauri.conf.json, which names the bundled resource folder.
const PRODUCT_NAME: &str = "ClawChat";
const DATABASE_POLL_INTERVAL: Duration = Duration::from_secs(2);

// sysexits.h, so the service's journal says what kind of failure it was.
pub const EXIT_USAGE: i32 = 64;
const EXIT_SOFTWARE: i32 = 70;
const EXIT_CONFIG: i32 = 78;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ServerOnlyOptions {
    /// Another data folder than the app's own, e.g. a copy to rehearse on.
    pub data_dir: Option<PathBuf>,
}

/// `Ok(None)` when the command line does not ask for server-only mode.
pub fn parse_arguments<I>(arguments: I) -> Result<Option<ServerOnlyOptions>, String>
where
    I: IntoIterator<Item = OsString>,
{
    let arguments: Vec<OsString> = arguments.into_iter().skip(1).collect();
    if !arguments
        .iter()
        .any(|argument| argument == SERVER_ONLY_FLAG)
    {
        return Ok(None);
    }
    let mut options = ServerOnlyOptions::default();
    let mut remaining = arguments.into_iter();
    while let Some(argument) = remaining.next() {
        if argument == SERVER_ONLY_FLAG {
            continue;
        }
        if argument == DATA_DIR_FLAG {
            let folder = remaining
                .next()
                .ok_or_else(|| format!("{DATA_DIR_FLAG} needs a folder"))?;
            options.data_dir = Some(PathBuf::from(folder));
            continue;
        }
        if let Some(folder) = argument
            .to_str()
            .and_then(|argument| argument.strip_prefix("--data-dir="))
        {
            options.data_dir = Some(PathBuf::from(folder));
            continue;
        }
        return Err(format!(
            "unknown argument {} (usage: {SERVER_ONLY_FLAG} [{DATA_DIR_FLAG} <folder>])",
            argument.to_string_lossy()
        ));
    }
    Ok(Some(options))
}

/// The same folders the window resolves through Tauri, without an app.
pub fn native_paths(
    options: &ServerOnlyOptions,
    executable: &Path,
    appdir: Option<&Path>,
) -> Result<NativePaths, String> {
    let app_data_dir = match &options.data_dir {
        Some(folder) => std::path::absolute(folder)
            .map_err(|error| format!("failed to resolve {}: {error}", folder.display()))?,
        None => dirs::data_dir()
            .ok_or_else(|| "failed to resolve the user data folder".to_owned())?
            .join(APP_IDENTIFIER),
    };
    let development_server_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|root| root.join("server"))
        .unwrap_or_default();
    Ok(NativePaths::in_app_data_dir(
        app_data_dir,
        resource_dir_for(executable, appdir),
        development_server_dir,
    ))
}

/// Where the bundle keeps `server-bin`, as Tauri's own `resource_dir`
/// resolves it for this executable.
pub fn resource_dir_for(executable: &Path, appdir: Option<&Path>) -> PathBuf {
    let executable_dir = executable
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default();
    if cfg!(windows) || executable_dir.join(".cargo-lock").exists() {
        return executable_dir;
    }
    if cfg!(target_os = "macos") {
        let resources = executable_dir.join("../Resources");
        return resources.canonicalize().unwrap_or(resources);
    }
    // An AppImage runs `$APPDIR/usr/bin/clawchat-tauri`; a .deb installs
    // `/usr/bin/clawchat-tauri`. Both keep resources in `../lib/ClawChat`.
    if let Ok(bundled) = executable_dir
        .join("../lib")
        .join(PRODUCT_NAME)
        .canonicalize()
    {
        return bundled;
    }
    match appdir {
        Some(appdir) => appdir.join("usr/lib").join(PRODUCT_NAME),
        None => Path::new("/usr/lib").join(PRODUCT_NAME),
    }
}

/// Block while another process serves `database`, saying so once.
///
/// When the desktop app's own server holds it, the service waits instead of
/// failing over and over, and takes over as soon as the app quits. A server
/// that slips in between this check and our own start is still refused by the
/// server's lock; systemd then starts us again and we wait here.
pub fn wait_until_database_is_free(
    database: &Path,
    poll_interval: Duration,
    mut report: impl FnMut(&str),
) {
    let mut announced = false;
    loop {
        match database_lock::probe(database) {
            Ok(DatabaseHolder::Free) => return,
            Ok(DatabaseHolder::Held) => {
                if !announced {
                    let holder = database_lock::read_owner(database)
                        .map(|owner| owner.describe())
                        .unwrap_or_else(|| "unknown process".to_owned());
                    report(&format!(
                        "[clawchat] another ClawChat server ({holder}) is serving {}; waiting for it to stop",
                        database.display()
                    ));
                    announced = true;
                }
            }
            Err(error) => {
                // Cannot tell from here; the server's own claim decides.
                report(&format!("[clawchat] {error}"));
                return;
            }
        }
        thread::sleep(poll_interval);
    }
}

/// Run the server in this process's place. Returns only on failure.
pub fn run(options: ServerOnlyOptions) -> i32 {
    // stderr goes to the service's journal. Not `startup_log`: that always
    // writes into the app's own data folder, even with --data-dir.
    let report = |message: &str| eprintln!("{message}");

    let executable = match std::env::current_exe() {
        Ok(executable) => executable,
        Err(error) => {
            report(&format!(
                "[clawchat] failed to locate this executable: {error}"
            ));
            return EXIT_SOFTWARE;
        }
    };
    let appdir = std::env::var_os("APPDIR").map(PathBuf::from);
    let paths = match native_paths(&options, &executable, appdir.as_deref()) {
        Ok(paths) => paths,
        Err(error) => {
            report(&format!("[clawchat] {error}"));
            return EXIT_CONFIG;
        }
    };

    let config_exists = paths.config_path.is_file();
    let config = match ConfigStore::new(paths.config_path.clone()).load() {
        Ok(config) => config,
        Err(error) => {
            report(&format!(
                "[clawchat] {error}. Fix it in the desktop app, then start the service again."
            ));
            return EXIT_CONFIG;
        }
    };
    if !config_exists {
        report(&format!(
            "[clawchat] {} does not exist yet; serving this machine only, with the default PIN. Open the desktop app once to choose a PIN and LAN access.",
            paths.config_path.display()
        ));
    }
    if let Err(error) = config.validate() {
        report(&format!("[clawchat] {error}"));
        return EXIT_CONFIG;
    }
    if config.port == 0 {
        report(
            "[clawchat] the desktop app picks a port automatically; choose a fixed port in its settings so phones can find this server",
        );
        return EXIT_CONFIG;
    }

    let supervisor = ServerSupervisor::new(paths.clone(), config.port);
    wait_until_database_is_free(&supervisor.database_file(), DATABASE_POLL_INTERVAL, report);
    let command = match supervisor.service_command(&config) {
        Ok(command) => command,
        Err(error) => {
            report(&format!("[clawchat] {error}"));
            return EXIT_SOFTWARE;
        }
    };
    report(&format!(
        "[clawchat] serving {} on {}:{}; server output goes to {}",
        paths.app_data_dir.display(),
        config.bind_host(),
        config.port,
        supervisor.server_log_path().display()
    ));
    replace_process(command, report)
}

/// On Unix the server takes over this process, so systemd's main PID, its
/// signals and its exit status are the server's own.
#[cfg(unix)]
fn replace_process(mut command: Command, report: impl Fn(&str)) -> i32 {
    use std::os::unix::process::CommandExt;

    let error = command.exec();
    report(&format!(
        "[clawchat] failed to start {}: {error}",
        command.get_program().to_string_lossy()
    ));
    EXIT_SOFTWARE
}

#[cfg(not(unix))]
fn replace_process(mut command: Command, report: impl Fn(&str)) -> i32 {
    match command.status() {
        Ok(status) => status.code().unwrap_or(EXIT_SOFTWARE),
        Err(error) => {
            report(&format!(
                "[clawchat] failed to start {}: {error}",
                command.get_program().to_string_lossy()
            ));
            EXIT_SOFTWARE
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs::{self, File},
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
    };

    use super::*;

    fn arguments(values: &[&str]) -> Vec<OsString> {
        std::iter::once("clawchat-tauri")
            .chain(values.iter().copied())
            .map(OsString::from)
            .collect()
    }

    #[test]
    fn an_ordinary_launch_is_not_server_only() {
        assert_eq!(parse_arguments(arguments(&[])), Ok(None));
        assert_eq!(
            parse_arguments(arguments(&["--some-webview-flag"])),
            Ok(None)
        );
    }

    #[test]
    fn server_only_uses_the_apps_data_folder_unless_told_otherwise() {
        assert_eq!(
            parse_arguments(arguments(&["--server-only"])),
            Ok(Some(ServerOnlyOptions::default()))
        );
        let rehearsal = Some(ServerOnlyOptions {
            data_dir: Some(PathBuf::from("/tmp/copy")),
        });
        assert_eq!(
            parse_arguments(arguments(&["--server-only", "--data-dir", "/tmp/copy"])),
            Ok(rehearsal.clone())
        );
        assert_eq!(
            parse_arguments(arguments(&["--data-dir=/tmp/copy", "--server-only"])),
            Ok(rehearsal)
        );
    }

    #[test]
    fn server_only_rejects_what_it_does_not_understand() {
        assert!(parse_arguments(arguments(&["--server-only", "--port", "9000"])).is_err());
        assert!(parse_arguments(arguments(&["--server-only", "--data-dir"])).is_err());
    }

    #[test]
    fn app_identity_matches_the_tauri_config() {
        let config: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .ancestors()
                    .find_map(|dir| {
                        let candidate = dir.join("tauri.conf.json");
                        candidate.is_file().then_some(candidate)
                    })
                    .expect("tauri.conf.json"),
            )
            .expect("read tauri.conf.json"),
        )
        .expect("parse tauri.conf.json");

        assert_eq!(config["identifier"], APP_IDENTIFIER);
        assert_eq!(config["productName"], PRODUCT_NAME);
    }

    #[test]
    fn the_data_folder_layout_matches_the_window() {
        let root = tempfile::tempdir().expect("temp dir");
        let copy = root.path().join("clawchat-copy");
        let options = ServerOnlyOptions {
            data_dir: Some(copy.clone()),
        };

        let paths =
            native_paths(&options, Path::new("/usr/bin/clawchat-tauri"), None).expect("paths");

        assert_eq!(paths.app_data_dir, copy);
        assert_eq!(paths.config_path, copy.join("server-config.json"));
        assert_eq!(paths.server_data_dir, copy.join("server-data").join("data"));
    }

    #[test]
    fn the_default_data_folder_is_the_apps() {
        let paths = native_paths(
            &ServerOnlyOptions::default(),
            Path::new("/usr/bin/clawchat-tauri"),
            None,
        )
        .expect("paths");

        assert!(paths.app_data_dir.ends_with(APP_IDENTIFIER));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn finds_the_server_inside_an_appimage_or_deb_layout() {
        let root = tempfile::tempdir().expect("temp dir");
        let appdir = root.path().join("squashfs-root");
        let executable = appdir.join("usr/bin/clawchat-tauri");
        fs::create_dir_all(executable.parent().expect("bin")).expect("bin dir");
        fs::create_dir_all(appdir.join("usr/lib/ClawChat/server-bin")).expect("resources");

        assert_eq!(
            resource_dir_for(&executable, None),
            appdir
                .join("usr/lib/ClawChat")
                .canonicalize()
                .expect("canonical")
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn falls_back_to_appdir_and_then_the_system_lib_folder() {
        let executable = Path::new("/nonexistent/bin/clawchat-tauri");

        assert_eq!(
            resource_dir_for(executable, Some(Path::new("/tmp/.mount_ClawCh1"))),
            Path::new("/tmp/.mount_ClawCh1/usr/lib/ClawChat")
        );
        assert_eq!(
            resource_dir_for(executable, None),
            Path::new("/usr/lib/ClawChat")
        );
    }

    #[test]
    fn a_free_database_does_not_wait() {
        let root = tempfile::tempdir().expect("temp dir");
        let mut reports = Vec::new();

        wait_until_database_is_free(
            &root.path().join("clawchat.db"),
            Duration::from_millis(10),
            |message| reports.push(message.to_owned()),
        );

        assert!(reports.is_empty());
    }

    #[test]
    fn waits_for_the_desktop_server_to_let_go_and_says_so_once() {
        let root = tempfile::tempdir().expect("temp dir");
        let database = root.path().join("clawchat.db");
        fs::write(
            database_lock::owner_path(&database),
            r#"{"pid": 31337, "port": 8000, "owner": "desktop"}"#,
        )
        .expect("owner record");
        let holder = File::create(database_lock::lock_path(&database)).expect("lock file");
        holder.lock().expect("hold lock");
        let releasing = Arc::new(AtomicBool::new(false));
        let releaser = {
            let releasing = Arc::clone(&releasing);
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(300));
                releasing.store(true, Ordering::SeqCst);
                holder.unlock().expect("release");
            })
        };
        let mut reports = Vec::new();

        wait_until_database_is_free(&database, Duration::from_millis(20), |message| {
            reports.push(message.to_owned())
        });

        assert!(
            releasing.load(Ordering::SeqCst),
            "returned while the desktop server still held the database"
        );
        releaser.join().expect("releaser");
        assert_eq!(reports.len(), 1, "{reports:?}");
        assert!(reports[0].contains("pid 31337, port 8000, started by the desktop app"));
    }
}
