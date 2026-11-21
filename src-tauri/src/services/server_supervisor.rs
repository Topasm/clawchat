use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    thread,
    time::{Duration, Instant},
};

use crate::{
    models::{NativePaths, ServerConfig, ServerState, ServerStatus},
    services::database_lock::{
        self, DatabaseHolder, DatabaseOwner, DATABASE_IN_USE_MARKER, OWNER_DESKTOP, OWNER_SERVICE,
    },
    startup_log,
};

const STARTUP_HEALTH_TIMEOUT: Duration = Duration::from_secs(60);
const HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(250);
const SERVER_LOG_DIAGNOSTIC_BYTES: usize = 4_000;
const PORT_BIND_RETRY_LIMIT: usize = 3;
/// How long a server run by someone else gets to let go of the database after
/// it was asked to stop, before the start path takes over the waiting.
const EXTERNAL_STOP_TIMEOUT: Duration = Duration::from_secs(15);
const DATABASE_FILE: &str = "clawchat.db";

enum HealthWaitOutcome {
    Ready,
    Exited(ExitStatus),
    TimedOut,
}

pub struct ServerSupervisor {
    paths: NativePaths,
    child: Option<Child>,
    /// A server an earlier launch of this app started, still running after
    /// that launch crashed or was killed. Stopped like `child`.
    reused_pid: Option<u32>,
    /// A server someone else runs for this workspace: the `--server-only`
    /// service, or one started by hand. The app uses it and never stops it on
    /// quit; a restart asks it to stop so the new settings apply (ADR 021).
    external_pid: Option<u32>,
    status: ServerStatus,
}

impl ServerSupervisor {
    pub fn new(paths: NativePaths, port: u16) -> Self {
        Self {
            paths,
            child: None,
            reused_pid: None,
            external_pid: None,
            status: ServerStatus {
                state: ServerState::Stopped,
                port,
                pid: None,
                error: None,
            },
        }
    }

    pub fn status(&mut self) -> ServerStatus {
        if let Some(child) = self.child.as_mut() {
            match child.try_wait() {
                Ok(Some(exit)) => {
                    self.child = None;
                    self.reused_pid = None;
                    let _ = fs::remove_file(&self.paths.pid_path);
                    self.status = ServerStatus {
                        state: if exit.success() {
                            ServerState::Stopped
                        } else {
                            ServerState::Error
                        },
                        port: self.status.port,
                        pid: None,
                        error: (!exit.success()).then(|| format!("server exited with {exit}")),
                    };
                }
                Ok(None) => {}
                Err(error) => {
                    self.status.state = ServerState::Error;
                    self.status.error = Some(format!("failed to inspect server process: {error}"));
                }
            }
        }
        self.status.clone()
    }

    pub fn start(&mut self, config: &ServerConfig) -> ServerStatus {
        let requested_port = config.port;
        if let Err(error) = config.validate() {
            self.status = ServerStatus {
                state: ServerState::Error,
                port: requested_port,
                pid: None,
                error: Some(error),
            };
            return self.status.clone();
        }
        if self.child.is_some() {
            let current = self.status();
            if matches!(current.state, ServerState::Running) && health_check(current.port) {
                return current;
            }
            self.stop();
        }

        // Another process already serves this workspace's database. Use it:
        // a second server would put two writers on one SQLite file, and the
        // server would refuse to start anyway (ADR 021).
        if let Some(status) = self.attach_to_database_owner() {
            return status;
        }

        if health_check(requested_port) {
            let pid = read_pid(&self.paths.pid_path);
            self.reused_pid = pid;
            self.status = ServerStatus {
                state: ServerState::Running,
                port: requested_port,
                pid,
                error: None,
            };
            return self.status.clone();
        }
        let _ = fs::remove_file(&self.paths.pid_path);

        // Port 8000 is a common development default. A local-first desktop
        // app should not become unusable just because another tool already
        // owns it, so select a free loopback port for this workspace.
        let mut port = match choose_start_port(requested_port) {
            Ok(port) => port,
            Err(error) => {
                self.status = ServerStatus {
                    state: ServerState::Error,
                    port: requested_port,
                    pid: None,
                    error: Some(error),
                };
                return self.status.clone();
            }
        };
        let mut failed_ports = Vec::new();
        for bind_attempt in 0..=PORT_BIND_RETRY_LIMIT {
            let mut effective_config = config.clone();
            effective_config.port = port;
            self.status = ServerStatus {
                state: ServerState::Starting,
                port,
                pid: None,
                error: None,
            };

            let log_path = self.paths.app_data_dir.join("server.log");
            let log_offset = fs::metadata(&log_path)
                .map(|metadata| metadata.len() as usize)
                .unwrap_or(0);
            match self.spawn(&effective_config) {
                Ok(child) => {
                    let pid = child.id();
                    self.child = Some(child);
                    if let Err(error) = write_pid(&self.paths.pid_path, pid) {
                        startup_log::report(&format!("[clawchat] {error}"));
                    }
                    let started_at = Instant::now();
                    let outcome = self
                        .child
                        .as_mut()
                        .map(|child| wait_for_health(port, child))
                        .unwrap_or(HealthWaitOutcome::TimedOut);
                    match outcome {
                        HealthWaitOutcome::Ready => {
                            startup_log::report(&format!(
                                "[clawchat] local server ready on port {port} after {:.1}s",
                                started_at.elapsed().as_secs_f32()
                            ));
                            self.status = ServerStatus {
                                state: ServerState::Running,
                                port,
                                pid: Some(pid),
                                error: None,
                            };
                            break;
                        }
                        HealthWaitOutcome::Exited(exit) => {
                            // `try_wait` already reaped the child. Drop the handle
                            // without signalling a PID that the OS may later reuse.
                            self.child = None;
                            let _ = fs::remove_file(&self.paths.pid_path);
                            let attempt_output =
                                read_log_since(&log_path, log_offset, SERVER_LOG_DIAGNOSTIC_BYTES);
                            // Someone claimed the database between the check
                            // above and this server's own claim.
                            if attempt_output.as_deref().is_some_and(is_database_in_use) {
                                if let Some(status) = self.attach_to_database_owner() {
                                    return status;
                                }
                            }
                            if bind_attempt < PORT_BIND_RETRY_LIMIT
                                && attempt_output.as_deref().is_some_and(is_bind_conflict)
                            {
                                failed_ports.push(port);
                                match choose_retry_port(&failed_ports) {
                                    Ok(retry_port) => {
                                        startup_log::report(&format!(
                                            "[clawchat] port {port} was claimed during startup; retrying on port {retry_port}"
                                        ));
                                        port = retry_port;
                                        continue;
                                    }
                                    Err(error) => {
                                        self.status = ServerStatus {
                                            state: ServerState::Error,
                                            port,
                                            pid: None,
                                            error: Some(error),
                                        };
                                        break;
                                    }
                                }
                            }
                            self.status = ServerStatus {
                                state: ServerState::Error,
                                port,
                                pid: None,
                                error: Some(self.startup_error(format!(
                                    "server exited with {exit} before becoming ready"
                                ))),
                            };
                            break;
                        }
                        HealthWaitOutcome::TimedOut => {
                            self.stop_child();
                            self.status = ServerStatus {
                                state: ServerState::Error,
                                port,
                                pid: None,
                                error: Some(self.startup_error(format!(
                                    "server did not become ready within {} seconds",
                                    STARTUP_HEALTH_TIMEOUT.as_secs()
                                ))),
                            };
                            break;
                        }
                    }
                }
                Err(error) => {
                    self.status = ServerStatus {
                        state: ServerState::Error,
                        port,
                        pid: None,
                        error: Some(error),
                    };
                    break;
                }
            }
        }
        self.status.clone()
    }

    fn startup_error(&self, summary: String) -> String {
        let log_path = self.paths.app_data_dir.join("server.log");
        match read_log_tail(&log_path, SERVER_LOG_DIAGNOSTIC_BYTES) {
            Some(diagnostic) => format!("{summary}. Last server output: {diagnostic}"),
            None => format!(
                "{summary}. No server output was recorded; see {}",
                log_path.display()
            ),
        }
    }

    pub fn stop(&mut self) -> ServerStatus {
        self.stop_child();
        if let Some(pid) = self.reused_pid.take() {
            terminate_pid(pid);
        }
        if let Some(pid) = self.external_pid.take() {
            startup_log::report(&format!(
                "[clawchat] left the workspace server (pid {pid}) running; this app did not start it"
            ));
        }
        let _ = fs::remove_file(&self.paths.pid_path);
        self.status = ServerStatus {
            state: ServerState::Stopped,
            port: self.status.port,
            pid: None,
            error: None,
        };
        self.status.clone()
    }

    pub fn restart(&mut self, config: &ServerConfig) -> ServerStatus {
        if let Some(pid) = self.external_pid.take() {
            // A new PIN, port or LAN setting only takes effect when a server
            // starts. Ask the service's server to stop; whoever claims the
            // database next -- this app, or the service once systemd starts
            // it again -- reads the settings just saved.
            startup_log::report(&format!(
                "[clawchat] asking the workspace server (pid {pid}) to restart with the new settings"
            ));
            terminate_process(pid);
            self.wait_for_database_release(EXTERNAL_STOP_TIMEOUT);
        }
        self.stop();
        self.start(config)
    }

    fn database_path(&self) -> PathBuf {
        self.paths.server_data_dir.join(DATABASE_FILE)
    }

    /// Connect to the server that holds this workspace's database, if any.
    ///
    /// `None` means nobody holds it and the caller may start a server. A
    /// holder that is still migrating has not bound its port yet, so wait for
    /// it like for a server of our own.
    fn attach_to_database_owner(&mut self) -> Option<ServerStatus> {
        let database = self.database_path();
        match database_lock::probe(&database) {
            Ok(DatabaseHolder::Held) => {}
            Ok(DatabaseHolder::Free) => return None,
            Err(error) => {
                startup_log::report(&format!("[clawchat] {error}"));
                return None;
            }
        }
        let deadline = Instant::now() + STARTUP_HEALTH_TIMEOUT;
        let mut last_owner = None;
        loop {
            if let Some(owner) = database_lock::read_owner(&database) {
                if health_check(owner.port) {
                    return Some(self.attach(owner));
                }
                last_owner = Some(owner);
            }
            if matches!(database_lock::probe(&database), Ok(DatabaseHolder::Free)) {
                // The holder stopped while we waited.
                return None;
            }
            if Instant::now() >= deadline {
                let holder = last_owner
                    .as_ref()
                    .map(DatabaseOwner::describe)
                    .unwrap_or_else(|| "unknown process".to_owned());
                self.status = ServerStatus {
                    state: ServerState::Error,
                    port: last_owner
                        .as_ref()
                        .map_or(self.status.port, |owner| owner.port),
                    pid: None,
                    error: Some(format!(
                        "another ClawChat server ({holder}) holds this workspace's database but did not answer within {} seconds",
                        STARTUP_HEALTH_TIMEOUT.as_secs()
                    )),
                };
                return Some(self.status.clone());
            }
            thread::sleep(HEALTH_POLL_INTERVAL);
        }
    }

    fn attach(&mut self, owner: DatabaseOwner) -> ServerStatus {
        if owner.started_by_desktop() {
            // An earlier launch of this app started it and then crashed or was
            // killed. Adopt it: quitting stops it, as it would have then.
            self.reused_pid = Some(owner.pid);
            self.external_pid = None;
        } else {
            self.external_pid = Some(owner.pid);
            self.reused_pid = None;
            startup_log::report(&format!(
                "[clawchat] using the workspace server that is already running ({}); it keeps running when the app quits",
                owner.describe()
            ));
        }
        self.status = ServerStatus {
            state: ServerState::Running,
            port: owner.port,
            pid: Some(owner.pid),
            error: None,
        };
        self.status.clone()
    }

    fn wait_for_database_release(&self, timeout: Duration) {
        let database = self.database_path();
        let deadline = Instant::now() + timeout;
        while matches!(database_lock::probe(&database), Ok(DatabaseHolder::Held))
            && Instant::now() < deadline
        {
            thread::sleep(HEALTH_POLL_INTERVAL);
        }
    }

    fn stop_child(&mut self) {
        let Some(mut child) = self.child.take() else {
            return;
        };
        let pid = child.id();
        signal_pid(pid, false);
        for _ in 0..25 {
            match child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => thread::sleep(Duration::from_millis(200)),
                Err(_) => break,
            }
        }
        signal_pid(pid, true);
        let _ = child.kill();
        let _ = child.wait();
    }

    fn spawn(&self, config: &ServerConfig) -> Result<Child, String> {
        let mut command = self.server_process(config, OWNER_DESKTOP)?;
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        self.redirect_output(&mut command, config.port, "bundled server");
        command.spawn().map_err(|error| {
            format!(
                "failed to start server executable {}: {error}",
                command.get_program().to_string_lossy()
            )
        })
    }

    /// The server as the `--server-only` service runs it: the same program
    /// and environment the app uses, output appended to the same
    /// `server.log`, and left in the service's own process group so systemd
    /// signals it directly.
    pub fn service_command(&self, config: &ServerConfig) -> Result<Command, String> {
        let mut command = self.server_process(config, OWNER_SERVICE)?;
        self.redirect_output(&mut command, config.port, "server-only service");
        Ok(command)
    }

    pub fn server_log_path(&self) -> PathBuf {
        self.paths.app_data_dir.join("server.log")
    }

    pub fn database_file(&self) -> PathBuf {
        self.database_path()
    }

    fn server_process(&self, config: &ServerConfig, owner: &str) -> Result<Command, String> {
        fs::create_dir_all(self.paths.server_data_dir.join("uploads")).map_err(|error| {
            format!(
                "failed to create server data directory {}: {error}",
                self.paths.server_data_dir.display()
            )
        })?;
        let (program, arguments, working_directory) = self.server_command(config)?;
        let database = self.database_path();
        let uploads = self.paths.server_data_dir.join("uploads");
        let mut command = Command::new(&program);
        command
            .args(arguments)
            .current_dir(working_directory)
            // Recorded beside the database, so a later app launch knows
            // whether this server is its own to stop (ADR 021).
            .env("SERVER_OWNER", owner)
            .env("HOST", config.bind_host())
            .env("PORT", config.port.to_string())
            .env("PIN", &config.pin)
            .env(
                "JWT_SECRET_FILE",
                self.paths.app_data_dir.join("server-jwt-secret"),
            )
            .env(
                "DATABASE_URL",
                format!("sqlite+aiosqlite:///{}", database.display()),
            )
            .env(
                "CODEX_API_KEY_FILE",
                self.paths.app_data_dir.join("codex-api-key"),
            )
            // Without this the packaged server restarts on AI_PROVIDER every
            // time, discarding the provider picked in the settings screen.
            .env(
                "AI_PROVIDER_FILE",
                self.paths.app_data_dir.join("active-ai-provider"),
            )
            .env("UPLOAD_DIR", uploads);
        if !config.obsidian_vault_path.is_empty() {
            command.env("OBSIDIAN_VAULT_PATH", &config.obsidian_vault_path);
        }
        if let Some(obsidian) = find_obsidian_cli() {
            command.env("OBSIDIAN_CLI_COMMAND", obsidian);
        }
        command.stdin(Stdio::null());
        Ok(command)
    }

    fn redirect_output(&self, command: &mut Command, port: u16, label: &str) {
        let log_path = self.server_log_path();
        match OpenOptions::new().create(true).append(true).open(&log_path) {
            Ok(mut stdout) => match stdout.try_clone() {
                Ok(stderr) => {
                    let _ = writeln!(
                        stdout,
                        "\n[clawchat] --- starting {label} on port {port} ---"
                    );
                    command
                        .stdout(Stdio::from(stdout))
                        .stderr(Stdio::from(stderr));
                }
                Err(_) => {
                    command.stdout(Stdio::null()).stderr(Stdio::null());
                }
            },
            Err(_) => {
                command.stdout(Stdio::null()).stderr(Stdio::null());
            }
        }
    }

    fn server_command(
        &self,
        config: &ServerConfig,
    ) -> Result<(PathBuf, Vec<String>, PathBuf), String> {
        let executable_name = if cfg!(windows) {
            "clawchat-server.exe"
        } else {
            "clawchat-server"
        };
        let packaged = self
            .paths
            .resource_dir
            .join("server-bin")
            .join(executable_name);
        if packaged.is_file() {
            return Ok((packaged, vec![], self.paths.app_data_dir.clone()));
        }
        if !cfg!(debug_assertions) {
            return Err(format!(
                "packaged server binary is missing: {}",
                packaged.display()
            ));
        }

        let python = find_python(&self.paths.development_server_dir);
        let mut arguments = vec![
            "-m".to_owned(),
            "uvicorn".to_owned(),
            "main:app".to_owned(),
            "--host".to_owned(),
            config.bind_host().to_owned(),
            "--port".to_owned(),
            config.port.to_string(),
        ];
        if std::env::var_os("VITE_DEV_SERVER_URL").is_some() {
            arguments.push("--reload".to_owned());
        }
        Ok((python, arguments, self.paths.development_server_dir.clone()))
    }
}

impl Drop for ServerSupervisor {
    fn drop(&mut self) {
        self.stop_child();
    }
}

fn find_python(server_dir: &Path) -> PathBuf {
    let candidates = [
        server_dir.join("venv/bin/python"),
        server_dir.join("venv/Scripts/python.exe"),
    ];
    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .unwrap_or_else(|| PathBuf::from(if cfg!(windows) { "python" } else { "python3" }))
}

fn find_obsidian_cli() -> Option<PathBuf> {
    if let Some(value) = std::env::var_os("OBSIDIAN_CLI_COMMAND") {
        return Some(PathBuf::from(value));
    }
    let candidates = if cfg!(target_os = "macos") {
        vec![PathBuf::from(
            "/Applications/Obsidian.app/Contents/MacOS/Obsidian",
        )]
    } else if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA")
            .map(|root| PathBuf::from(root).join("Programs/obsidian/Obsidian.exe"))
            .into_iter()
            .collect()
    } else {
        vec![
            PathBuf::from("/usr/bin/obsidian"),
            PathBuf::from("/usr/local/bin/obsidian"),
        ]
    };
    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn health_check(port: u16) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_secs(1)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let request =
        format!("GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut response = Vec::with_capacity(1024);
    let Ok(_) = stream.take(8192).read_to_end(&mut response) else {
        return false;
    };
    let response = String::from_utf8_lossy(&response);
    let Some((headers, body)) = response.split_once("\r\n\r\n") else {
        return false;
    };
    let successful = headers.starts_with("HTTP/1.1 200") || headers.starts_with("HTTP/1.0 200");
    if !successful {
        return false;
    }
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|payload| {
            payload
                .get("service")
                .and_then(|value| value.as_str())
                .map(str::to_owned)
        })
        .is_some_and(|service| service == "clawchat")
}

fn choose_start_port(requested: u16) -> Result<u16, String> {
    // Port zero asks the OS to choose, but uvicorn does not report that choice
    // back to the shell. Resolve it here so status and auto-login use the same
    // concrete port.
    if requested != 0 && TcpListener::bind(("0.0.0.0", requested)).is_ok() {
        return Ok(requested);
    }
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("failed to find a free local server port: {error}"))?;
    listener
        .local_addr()
        .map(|address| address.port())
        .map_err(|error| format!("failed to inspect a free local server port: {error}"))
}

fn choose_retry_port(failed_ports: &[u16]) -> Result<u16, String> {
    // The listener returned by `choose_start_port` cannot be inherited by the
    // cross-platform sidecar. A second process can therefore still win the
    // small gap before uvicorn binds. Avoid ports that already lost that race
    // and make a few OS-assigned selections before reporting an error.
    for _ in 0..16 {
        let port = choose_start_port(0)?;
        if !failed_ports.contains(&port) {
            return Ok(port);
        }
    }
    Err("failed to find a new local server port after a startup collision".to_owned())
}

fn wait_for_health(port: u16, child: &mut Child) -> HealthWaitOutcome {
    let deadline = Instant::now() + STARTUP_HEALTH_TIMEOUT;
    loop {
        if let Ok(Some(exit)) = child.try_wait() {
            return HealthWaitOutcome::Exited(exit);
        }
        if health_check(port) {
            // A competing ClawChat process can claim the port after the
            // preflight probe but before this child binds. Give the child one
            // polling interval to report that bind failure before accepting a
            // healthy response that may belong to the competitor.
            thread::sleep(HEALTH_POLL_INTERVAL);
            if let Ok(Some(exit)) = child.try_wait() {
                return HealthWaitOutcome::Exited(exit);
            }
            if health_check(port) {
                return HealthWaitOutcome::Ready;
            }
        }
        if Instant::now() >= deadline {
            return HealthWaitOutcome::TimedOut;
        }
        thread::sleep(HEALTH_POLL_INTERVAL);
    }
}

fn read_log_since(path: &Path, offset: usize, maximum_bytes: usize) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    let attempt_start = if offset <= bytes.len() { offset } else { 0 };
    let start = attempt_start.max(bytes.len().saturating_sub(maximum_bytes));
    let diagnostic = String::from_utf8_lossy(&bytes[start..])
        .trim()
        .replace(['\r', '\n'], " ");
    (!diagnostic.is_empty()).then_some(diagnostic)
}

fn is_database_in_use(output: &str) -> bool {
    output.contains(DATABASE_IN_USE_MARKER)
}

fn is_bind_conflict(output: &str) -> bool {
    let output = output.to_ascii_lowercase();
    output.contains("address already in use")
        || output.contains("only one usage of each socket address")
        || output.contains("errno 48")
        || output.contains("errno 98")
        || output.contains("error 10048")
}

fn read_log_tail(path: &Path, maximum_bytes: usize) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    let start = bytes.len().saturating_sub(maximum_bytes);
    let diagnostic = String::from_utf8_lossy(&bytes[start..])
        .trim()
        .replace(['\r', '\n'], " ");
    (!diagnostic.is_empty()).then_some(diagnostic)
}

fn read_pid(path: &Path) -> Option<u32> {
    fs::read_to_string(path).ok()?.trim().parse().ok()
}

fn write_pid(path: &Path, pid: u32) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, pid.to_string())
        .map_err(|error| format!("failed to write PID file {}: {error}", path.display()))
}

fn terminate_pid(pid: u32) {
    signal_pid(pid, false);
}

/// SIGTERM one process, not its group: a server someone else started may
/// share a process group with its launcher (a shell, or nothing we know).
fn terminate_process(pid: u32) {
    #[cfg(windows)]
    let mut command = {
        let mut command = Command::new("taskkill");
        command.args(["/PID", &pid.to_string()]);
        command
    };
    #[cfg(not(windows))]
    let mut command = {
        let mut command = Command::new("kill");
        command.args(["-TERM", &pid.to_string()]);
        command
    };
    command.stdout(Stdio::null()).stderr(Stdio::null());
    let _ = command.status();
}

fn signal_pid(pid: u32, force: bool) {
    #[cfg(windows)]
    let mut command = {
        let mut command = Command::new("taskkill");
        command.args(["/PID", &pid.to_string(), "/T"]);
        if force {
            command.arg("/F");
        }
        command
    };
    #[cfg(not(windows))]
    let mut command = {
        let mut command = Command::new("kill");
        let signal = if force { "-KILL" } else { "-TERM" };
        command.args([signal, "--", &format!("-{pid}")]);
        command
    };
    command.stdout(Stdio::null()).stderr(Stdio::null());
    let _ = command.status();
}

#[cfg(test)]
mod tests {
    use std::net::TcpListener;

    use super::*;

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

    #[test]
    fn accepts_successful_health_response() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("listener");
        let port = listener.local_addr().expect("address").port();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("connection");
            let mut request = [0_u8; 256];
            let _ = stream.read(&mut request);
            let body = r#"{"service":"clawchat","status":"degraded"}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).expect("response");
        });

        assert!(health_check(port));
        server.join().expect("server thread");
    }

    #[test]
    fn rejects_an_unrelated_service_on_the_configured_port() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("listener");
        let port = listener.local_addr().expect("address").port();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("connection");
            let mut request = [0_u8; 256];
            let _ = stream.read(&mut request);
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}")
                .expect("response");
        });

        assert!(!health_check(port));
        server.join().expect("server thread");
    }

    #[test]
    fn selects_another_port_when_the_preferred_port_is_busy() {
        let occupied = TcpListener::bind(("0.0.0.0", 0)).expect("occupied listener");
        let requested = occupied.local_addr().expect("address").port();

        let selected = choose_start_port(requested).expect("fallback port");

        assert_ne!(selected, requested);
        // The probe listener is intentionally released before returning so
        // the sidecar can bind. Rebinding here would race every other process
        // asking the OS for an ephemeral port and make this test flaky.
    }

    #[test]
    fn resolves_port_zero_before_starting_the_server() {
        let selected = choose_start_port(0).expect("concrete port");

        assert_ne!(selected, 0);
    }

    #[test]
    fn startup_diagnostic_uses_only_the_tail_and_flattens_lines() {
        let root = tempfile::tempdir().expect("temp dir");
        let log = root.path().join("server.log");
        fs::write(&log, "discard this\nimportant line\nlast line").expect("server log");

        assert_eq!(
            read_log_tail(&log, 24),
            Some("important line last line".to_owned())
        );
    }

    #[test]
    fn bind_conflict_detection_is_scoped_to_the_current_attempt() {
        let root = tempfile::tempdir().expect("temp dir");
        let log = root.path().join("server.log");
        let old_output = "ERROR: [Errno 48] address already in use\n";
        fs::write(&log, old_output).expect("old server log");
        fs::write(&log, format!("{old_output}new startup failure\n")).expect("new server log");

        let current = read_log_since(&log, old_output.len(), 4_000).expect("current output");

        assert_eq!(current, "new startup failure");
        assert!(!is_bind_conflict(&current));
        assert!(is_bind_conflict(
            "ERROR: [Errno 48] error while attempting to bind: address already in use"
        ));
        assert!(is_bind_conflict(
            "Only one usage of each socket address is normally permitted (error 10048)"
        ));
    }

    #[cfg(unix)]
    #[test]
    fn retries_on_a_port_claimed_between_selection_and_sidecar_bind() {
        use std::os::unix::fs::PermissionsExt;

        let root = tempfile::tempdir().expect("temp dir");
        let native_paths = paths(root.path());
        let executable = native_paths
            .resource_dir
            .join("server-bin")
            .join("clawchat-server");
        fs::create_dir_all(executable.parent().expect("binary parent")).expect("binary dir");
        fs::write(
            &executable,
            r#"#!/bin/sh
attempt_file="$PWD/start-attempts"
if [ ! -f "$attempt_file" ]; then
  printf 'first\n' > "$attempt_file"
  echo 'ERROR: [Errno 48] error while attempting to bind: address already in use' >&2
  exit 3
fi
printf 'second\n' >> "$attempt_file"
exec python3 -c '
import os
import socket

listener = socket.socket()
listener.bind((os.environ["HOST"], int(os.environ["PORT"])))
listener.listen()
while True:
    connection, _ = listener.accept()
    connection.recv(8192)
    body = b"{\"service\":\"clawchat\"}"
    response = (b"HTTP/1.1 200 OK\r\nContent-Length: " + str(len(body)).encode()
                + b"\r\nConnection: close\r\n\r\n" + body)
    connection.sendall(response)
    connection.close()
'
"#,
        )
        .expect("fake server");
        let mut permissions = fs::metadata(&executable).expect("metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&executable, permissions).expect("executable permissions");

        let probe = TcpListener::bind(("127.0.0.1", 0)).expect("preferred port probe");
        let requested_port = probe.local_addr().expect("preferred address").port();
        drop(probe);
        let config = ServerConfig {
            port: requested_port,
            ..ServerConfig::default()
        };
        let mut supervisor = ServerSupervisor::new(native_paths, requested_port);

        let status = supervisor.start(&config);

        assert!(
            matches!(status.state, ServerState::Running),
            "startup failed: {:?}",
            status.error
        );
        assert_ne!(status.port, requested_port);
        assert_eq!(
            fs::read_to_string(root.path().join("start-attempts")).expect("attempt log"),
            "first\nsecond\n"
        );
        supervisor.stop();
    }

    /// Stands in for a server that claimed the database: takes the lock,
    /// writes the owner record and answers health checks, like
    /// `server/services/database_lock.py` and `/api/health`.
    #[cfg(unix)]
    const FAKE_DATABASE_HOLDER: &str = r#"
import fcntl, json, os, socket, sys

database = sys.argv[1] if len(sys.argv) > 1 else os.environ["DATABASE_URL"].split("///", 1)[1]
owner = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("SERVER_OWNER", "standalone")
lock = open(database + ".lock", "a+b")
try:
    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    print("ClawChat database in use: another server already serves " + database, file=sys.stderr)
    sys.exit(75)
listener = socket.socket()
listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
listener.bind((os.environ.get("HOST", "127.0.0.1"), int(os.environ.get("PORT", "0"))))
listener.listen()
record = {"pid": os.getpid(), "host": "127.0.0.1", "port": listener.getsockname()[1],
          "owner": owner, "version": "test"}
with open(database + ".owner.json.tmp", "w") as handle:
    json.dump(record, handle)
os.replace(database + ".owner.json.tmp", database + ".owner.json")
while True:
    connection, _ = listener.accept()
    connection.recv(8192)
    body = b'{"service":"clawchat"}'
    connection.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: " + str(len(body)).encode()
                       + b"\r\nConnection: close\r\n\r\n" + body)
    connection.close()
"#;

    #[cfg(unix)]
    fn write_executable(path: &Path, contents: &str) {
        use std::os::unix::fs::PermissionsExt;

        fs::create_dir_all(path.parent().expect("parent")).expect("parent dir");
        fs::write(path, contents).expect("script");
        let mut permissions = fs::metadata(path).expect("metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).expect("executable permissions");
    }

    #[cfg(unix)]
    fn holder_script(root: &Path) -> PathBuf {
        let script = root.join("holder.py");
        fs::write(&script, FAKE_DATABASE_HOLDER).expect("holder script");
        script
    }

    #[cfg(unix)]
    fn wait_for_owner(database: &Path, pid: Option<u32>) -> DatabaseOwner {
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            if let Some(owner) = database_lock::read_owner(database) {
                if pid.is_none_or(|pid| owner.pid == pid) {
                    return owner;
                }
            }
            assert!(
                Instant::now() < deadline,
                "the holder never claimed the database"
            );
            thread::sleep(Duration::from_millis(50));
        }
    }

    /// A server some other launcher started, holding the workspace database.
    #[cfg(unix)]
    fn start_database_holder(root: &Path, database: &Path, owner: &str) -> (Child, DatabaseOwner) {
        use std::os::unix::process::CommandExt;

        fs::create_dir_all(database.parent().expect("database dir")).expect("database dir");
        let child = Command::new("python3")
            .arg(holder_script(root))
            .arg(database)
            .arg(owner)
            .env_remove("PORT")
            .env_remove("HOST")
            .process_group(0)
            .spawn()
            .expect("holder process");
        let record = wait_for_owner(database, Some(child.id()));
        (child, record)
    }

    #[cfg(unix)]
    fn wait_for_exit(child: &mut Child) -> bool {
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            if let Ok(Some(_)) = child.try_wait() {
                return true;
            }
            thread::sleep(Duration::from_millis(50));
        }
        false
    }

    #[cfg(unix)]
    fn free_port() -> u16 {
        let probe = TcpListener::bind(("127.0.0.1", 0)).expect("port probe");
        probe.local_addr().expect("address").port()
    }

    #[cfg(unix)]
    #[test]
    fn uses_the_server_that_already_serves_the_workspace_and_leaves_it_running() {
        let root = tempfile::tempdir().expect("temp dir");
        let native_paths = paths(root.path());
        let database = native_paths.server_data_dir.join(DATABASE_FILE);
        let (mut holder, record) = start_database_holder(root.path(), &database, OWNER_SERVICE);
        let config = ServerConfig {
            port: free_port(),
            ..ServerConfig::default()
        };
        let mut supervisor = ServerSupervisor::new(native_paths, config.port);

        let status = supervisor.start(&config);

        assert!(
            matches!(status.state, ServerState::Running),
            "attach failed: {:?}",
            status.error
        );
        assert_eq!(status.port, record.port);
        assert_eq!(status.pid, Some(holder.id()));

        supervisor.stop();

        assert!(holder.try_wait().expect("holder state").is_none());
        assert!(health_check(record.port));
        let _ = holder.kill();
        let _ = holder.wait();
    }

    #[cfg(unix)]
    #[test]
    fn adopts_a_server_an_earlier_launch_left_running_and_stops_it_on_quit() {
        let root = tempfile::tempdir().expect("temp dir");
        let native_paths = paths(root.path());
        let database = native_paths.server_data_dir.join(DATABASE_FILE);
        let (mut holder, record) = start_database_holder(root.path(), &database, OWNER_DESKTOP);
        let config = ServerConfig {
            port: free_port(),
            ..ServerConfig::default()
        };
        let mut supervisor = ServerSupervisor::new(native_paths, config.port);

        let status = supervisor.start(&config);
        assert!(matches!(status.state, ServerState::Running));
        assert_eq!(status.port, record.port);

        supervisor.stop();

        assert!(
            wait_for_exit(&mut holder),
            "the adopted server kept running"
        );
    }

    #[cfg(unix)]
    #[test]
    fn restart_asks_the_service_server_to_stop_and_takes_over_the_database() {
        let root = tempfile::tempdir().expect("temp dir");
        let native_paths = paths(root.path());
        let database = native_paths.server_data_dir.join(DATABASE_FILE);
        let script = holder_script(root.path());
        write_executable(
            &native_paths
                .resource_dir
                .join("server-bin")
                .join("clawchat-server"),
            &format!("#!/bin/sh\nexec python3 '{}'\n", script.display()),
        );
        let (mut service, service_record) =
            start_database_holder(root.path(), &database, OWNER_SERVICE);
        let config = ServerConfig {
            port: free_port(),
            ..ServerConfig::default()
        };
        let mut supervisor = ServerSupervisor::new(native_paths, config.port);
        assert_eq!(supervisor.start(&config).pid, Some(service.id()));

        let status = supervisor.restart(&config);

        assert!(
            matches!(status.state, ServerState::Running),
            "takeover failed: {:?}",
            status.error
        );
        assert!(
            wait_for_exit(&mut service),
            "the service's server ignored SIGTERM"
        );
        assert_ne!(status.pid, Some(service_record.pid));
        let record = wait_for_owner(&database, status.pid);
        assert_eq!(record.owner, OWNER_DESKTOP);
        assert_eq!(record.port, status.port);
        supervisor.stop();
    }

    #[cfg(unix)]
    #[test]
    fn connects_to_whoever_claimed_the_database_during_startup() {
        let root = tempfile::tempdir().expect("temp dir");
        let native_paths = paths(root.path());
        let database = native_paths.server_data_dir.join(DATABASE_FILE);
        let script = holder_script(root.path());
        // The service starts a moment after the app checked the database and
        // wins the claim; the app's own server then exits as the real one does.
        write_executable(
            &native_paths
                .resource_dir
                .join("server-bin")
                .join("clawchat-server"),
            &format!(
                r#"#!/bin/sh
db="${{DATABASE_URL#*///}}"
env -u PORT -u HOST python3 '{script}' "$db" service </dev/null >/dev/null 2>&1 &
i=0
while [ ! -f "$db.owner.json" ] && [ $i -lt 300 ]; do sleep 0.05; i=$((i+1)); done
echo "ClawChat database in use: another server already serves $db" >&2
exit 75
"#,
                script = script.display()
            ),
        );
        let config = ServerConfig {
            port: free_port(),
            ..ServerConfig::default()
        };
        let mut supervisor = ServerSupervisor::new(native_paths, config.port);

        let status = supervisor.start(&config);

        let record = wait_for_owner(&database, None);
        assert!(
            matches!(status.state, ServerState::Running),
            "startup race not handled: {:?}",
            status.error
        );
        assert_eq!(status.pid, Some(record.pid));
        assert_eq!(status.port, record.port);
        supervisor.stop();
        assert!(
            health_check(record.port),
            "quitting stopped the service's server"
        );
        terminate_process(record.pid);
    }

    #[test]
    fn recognises_the_servers_database_in_use_message() {
        assert!(is_database_in_use(
            "INFO: x ClawChat database in use: another server (pid 7, port 8000) already serves /d/clawchat.db."
        ));
        assert!(!is_database_in_use("database is locked"));
    }

    #[test]
    fn packaged_command_uses_onedir_executable() {
        let root = tempfile::tempdir().expect("temp dir");
        let native_paths = paths(root.path());
        let executable_name = if cfg!(windows) {
            "clawchat-server.exe"
        } else {
            "clawchat-server"
        };
        let executable = native_paths
            .resource_dir
            .join("server-bin")
            .join(executable_name);
        fs::create_dir_all(executable.parent().expect("binary parent")).expect("binary dir");
        fs::write(&executable, "placeholder").expect("binary");

        let supervisor = ServerSupervisor::new(native_paths, 8000);
        let config = ServerConfig::default();
        let (program, arguments, _) = supervisor.server_command(&config).expect("command");
        assert_eq!(program, executable);
        assert!(arguments.is_empty());
    }
}
