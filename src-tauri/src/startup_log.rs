use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
};

const APP_DATA_DIRECTORY: &str = "com.clawchat.desktop";
const STARTUP_LOG_FILE: &str = "startup.log";

pub fn report(message: &str) {
    let _ = writeln!(io::stderr().lock(), "{message}");
    let data_dir = dirs::data_dir();
    append_best_effort(data_dir.as_deref(), message);
}

fn startup_log_path(data_dir: &Path) -> PathBuf {
    data_dir.join(APP_DATA_DIRECTORY).join(STARTUP_LOG_FILE)
}

fn append_at(data_dir: &Path, message: &str) -> io::Result<()> {
    let path = startup_log_path(data_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut log = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(log, "{message}")
}

fn append_best_effort(data_dir: Option<&Path>, message: &str) {
    if let Some(data_dir) = data_dir {
        let _ = append_at(data_dir, message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_log_uses_application_data_directory() {
        let data_dir = Path::new("data-root");
        assert_eq!(
            startup_log_path(data_dir),
            data_dir.join("com.clawchat.desktop").join("startup.log")
        );
    }

    #[test]
    fn startup_log_appends_messages() {
        let data_dir = tempfile::tempdir().expect("temp dir");
        append_at(data_dir.path(), "first failure").expect("first append");
        append_at(data_dir.path(), "second failure").expect("second append");

        let contents = fs::read_to_string(startup_log_path(data_dir.path())).expect("startup log");
        assert_eq!(contents, "first failure\nsecond failure\n");
    }

    #[test]
    fn startup_log_ignores_filesystem_failures() {
        let data_dir = tempfile::tempdir().expect("temp dir");
        let file_instead_of_directory = data_dir.path().join("not-a-directory");
        fs::write(&file_instead_of_directory, "occupied").expect("blocking file");

        append_best_effort(Some(&file_instead_of_directory), "ignored failure");
    }
}
