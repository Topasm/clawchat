//! Running an agent CLI on this machine, for work addressed to it.
//!
//! The server never reaches into another machine's filesystem. When a project
//! is bound to this one, the server hands over the prompt and the directory,
//! and the CLI runs here — which is the only place the project's files exist.
//!
//! The CLI is allowed to write, because the work it is asked to do is editing
//! the project. It is confined to the directory the server named: that path
//! came from the project's binding, so "what this run may touch" is decided by
//! the binding rather than by whatever the model asks for.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tokio::process::Command;

/// How long a single run may take before it is abandoned.
const RUN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30 * 60);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerRunRequest {
    /// "claude" or "codex".
    pub provider: String,
    pub prompt: String,
    /// Directory the CLI runs in, as the server recorded it for this machine.
    pub cwd: String,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerRunResult {
    pub output: String,
    pub error: Option<String>,
}

fn find_cli(program: &str) -> Option<PathBuf> {
    if let Ok(path) = which_in_path(program) {
        return Some(path);
    }
    let home = dirs_home()?;
    let candidates = [
        home.join(".local/bin").join(program),
        home.join(".claude/bin").join(program),
        PathBuf::from("/usr/local/bin").join(program),
        PathBuf::from("/opt/homebrew/bin").join(program),
    ];
    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn which_in_path(program: &str) -> Result<PathBuf, ()> {
    let path = std::env::var_os("PATH").ok_or(())?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(program))
        .find(|candidate| candidate.is_file())
        .ok_or(())
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// Build the argument list for one provider.
///
/// Both CLIs are asked to work without stopping for approval, because nobody
/// is sitting in front of this window: the person delegated the task from
/// somewhere else, and a prompt nobody answers is a run that hangs. The result
/// still waits for human review on the server before it counts as done.
fn build_args(request: &WorkerRunRequest) -> Result<Vec<String>, String> {
    match request.provider.as_str() {
        "claude" => {
            let mut args = vec![
                "--print".to_owned(),
                "--output-format".to_owned(),
                "text".to_owned(),
                "--permission-mode".to_owned(),
                "acceptEdits".to_owned(),
            ];
            if let Some(model) = request.model.as_deref().filter(|m| !m.is_empty()) {
                args.push("--model".to_owned());
                args.push(model.to_owned());
            }
            args.push("-p".to_owned());
            args.push(request.prompt.clone());
            Ok(args)
        }
        "codex" => {
            let mut args = vec![
                "--ask-for-approval".to_owned(),
                "never".to_owned(),
                "--sandbox".to_owned(),
                // Writes are the point: the task is to edit this project. The
                // sandbox still holds the CLI to the directory the binding
                // named, so the reach is decided here and not by the model.
                "workspace-write".to_owned(),
                "exec".to_owned(),
            ];
            if let Some(model) = request.model.as_deref().filter(|m| !m.is_empty()) {
                args.push("--model".to_owned());
                args.push(model.to_owned());
            }
            args.extend([
                "--skip-git-repo-check".to_owned(),
                "--color".to_owned(),
                "never".to_owned(),
                "-".to_owned(),
            ]);
            Ok(args)
        }
        other => Err(format!("Unsupported worker provider: {other}")),
    }
}

pub async fn run(request: WorkerRunRequest) -> Result<WorkerRunResult, String> {
    let cwd = Path::new(&request.cwd);
    if !cwd.is_dir() {
        return Err(format!(
            "This machine has no directory at {}. Check the project's path for this host.",
            request.cwd
        ));
    }

    let program = match request.provider.as_str() {
        "claude" => "claude",
        "codex" => "codex",
        other => return Err(format!("Unsupported worker provider: {other}")),
    };
    let cli =
        find_cli(program).ok_or_else(|| format!("{program} is not installed on this machine"))?;

    let args = build_args(&request)?;
    let mut command = Command::new(cli);
    command
        .args(&args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start {program}: {error}"))?;

    if request.provider == "codex" {
        // Codex reads the prompt from stdin; the "-" argument above says so.
        use tokio::io::AsyncWriteExt;
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(request.prompt.as_bytes())
                .await
                .map_err(|error| format!("Could not send the prompt to {program}: {error}"))?;
            stdin
                .shutdown()
                .await
                .map_err(|error| format!("Could not finish the prompt for {program}: {error}"))?;
        }
    } else {
        drop(child.stdin.take());
    }

    let output = match tokio::time::timeout(RUN_TIMEOUT, child.wait_with_output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => return Err(format!("{program} failed to run: {error}")),
        Err(_) => {
            return Err(format!(
                "{program} did not finish within {} minutes",
                RUN_TIMEOUT.as_secs() / 60
            ))
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    if !output.status.success() {
        let detail = if stderr.is_empty() { stdout } else { stderr };
        return Err(format!("{program} exited with an error: {detail}"));
    }

    Ok(WorkerRunResult {
        output: stdout,
        error: if stderr.is_empty() {
            None
        } else {
            Some(stderr)
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(provider: &str, model: Option<&str>) -> WorkerRunRequest {
        WorkerRunRequest {
            provider: provider.to_owned(),
            prompt: "Summarise the results".to_owned(),
            cwd: "/tmp".to_owned(),
            model: model.map(str::to_owned),
        }
    }

    #[test]
    fn claude_runs_without_stopping_for_approval() {
        let args = build_args(&request("claude", Some("sonnet"))).expect("args");

        // Nobody is in front of this window: the task was delegated from
        // elsewhere, so a prompt for approval would hang the run.
        assert!(args.contains(&"--permission-mode".to_owned()));
        assert!(args.contains(&"acceptEdits".to_owned()));
        assert!(args.contains(&"sonnet".to_owned()));
        assert_eq!(args.last().unwrap(), "Summarise the results");
    }

    #[test]
    fn codex_may_write_inside_the_workspace_only() {
        let args = build_args(&request("codex", None)).expect("args");

        let sandbox = args
            .iter()
            .position(|arg| arg == "--sandbox")
            .expect("sandbox");
        assert_eq!(args[sandbox + 1], "workspace-write");
        assert!(!args.contains(&"danger-full-access".to_owned()));
    }

    #[test]
    fn an_empty_model_defers_to_the_cli_default() {
        let args = build_args(&request("claude", Some(""))).expect("args");

        assert!(!args.contains(&"--model".to_owned()));
    }

    #[test]
    fn an_unknown_provider_is_refused() {
        assert!(build_args(&request("pigeon", None)).is_err());
    }
}
