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
    startup_log,
};

const STARTUP_HEALTH_TIMEOUT: Duration = Duration::from_secs(60);
const HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(250);
const SERVER_LOG_DIAGNOSTIC_BYTES: usize = 4_000;
const PORT_BIND_RETRY_LIMIT: usize = 3;

enum HealthWaitOutcome {
    Ready,
    Exited(ExitStatus),
    TimedOut,
}

pub struct ServerSupervisor {
    paths: NativePaths,
    child: Option<Child>,
    reused_pid: Option<u32>,
    status: ServerStatus,
}

impl ServerSupervisor {
    pub fn new(paths: NativePaths, port: u16) -> Self {
        Self {
            paths,
            child: None,
            reused_pid: None,
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
        self.stop();
        self.start(config)
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
        fs::create_dir_all(self.paths.server_data_dir.join("uploads")).map_err(|error| {
            format!(
                "failed to create server data directory {}: {error}",
                self.paths.server_data_dir.display()
            )
        })?;
        let (program, arguments, working_directory) = self.server_command(config)?;
        let database = self.paths.server_data_dir.join("clawchat.db");
        let uploads = self.paths.server_data_dir.join("uploads");
        let mut command = Command::new(&program);
        command
            .args(arguments)
            .current_dir(working_directory)
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
            .env("UPLOAD_DIR", uploads);
        if !config.obsidian_vault_path.is_empty() {
            command.env("OBSIDIAN_VAULT_PATH", &config.obsidian_vault_path);
        }
        if let Some(obsidian) = find_obsidian_cli() {
            command.env("OBSIDIAN_CLI_COMMAND", obsidian);
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }

        let log_path = self.paths.app_data_dir.join("server.log");
        match OpenOptions::new().create(true).append(true).open(&log_path) {
            Ok(mut stdout) => match stdout.try_clone() {
                Ok(stderr) => {
                    let _ = writeln!(
                        stdout,
                        "\n[clawchat] --- starting bundled server on port {} ---",
                        config.port
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
        command.stdin(Stdio::null());
        command.spawn().map_err(|error| {
            format!(
                "failed to start server executable {}: {error}",
                program.display()
            )
        })
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
        TcpListener::bind(("127.0.0.1", selected)).expect("selected port is free");
    }

    #[test]
    fn resolves_port_zero_before_starting_the_server() {
        let selected = choose_start_port(0).expect("concrete port");

        assert_ne!(selected, 0);
        TcpListener::bind(("127.0.0.1", selected)).expect("selected port is free");
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
