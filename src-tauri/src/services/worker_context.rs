//! What a project folder says about itself, read on the machine that holds it.
//!
//! The server never reads another machine's disk. When this machine is the one
//! a project is bound to, it reads the folder's README-like files and sends a
//! bounded snapshot up, so chat and runs know what the folder is for. Only a
//! few well-known files are read, nothing is followed through a symlink, and
//! nothing outside the bound directory is touched: the binding decides the
//! reach, not the contents of the folder.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Per-file ceiling; the server trims again on its side.
pub const MAX_FILE_BYTES: usize = 8 * 1024;
/// Ceiling for the whole snapshot.
pub const MAX_TOTAL_BYTES: usize = 24 * 1024;
const MAX_FILES: usize = 8;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextFile {
    /// Relative to the bound directory, with `/` separators.
    pub path: String,
    pub text: String,
}

/// Read the folder's self-description, in the order the files are trusted.
pub fn read_context(root: &str) -> Result<Vec<ContextFile>, String> {
    let requested = Path::new(root);
    if !requested.is_dir() {
        return Err(format!(
            "This machine has no directory at {}. Check the project's path for this host.",
            requested.display()
        ));
    }
    let root = requested
        .canonicalize()
        .map_err(|error| format!("Could not resolve {}: {error}", requested.display()))?;

    let mut files = Vec::new();
    let mut budget = MAX_TOTAL_BYTES;
    for (relative, absolute) in candidate_files(&root) {
        if files.len() >= MAX_FILES {
            break;
        }
        let Some(text) = read_bounded(&root, &absolute) else {
            continue;
        };
        if text.is_empty() {
            continue;
        }
        if text.len() > budget {
            // Dropped whole rather than half-included: the file list is an
            // honest account of what the text contains.
            break;
        }
        budget -= text.len();
        files.push(ContextFile {
            path: relative,
            text,
        });
    }
    Ok(files)
}

fn candidate_files(root: &Path) -> Vec<(String, PathBuf)> {
    // `.clawchat/CONTEXT.md` is the folder's own word on what matters. When it
    // exists nothing else is read, so a curated note is never diluted by a
    // README written for a different audience.
    let pinned = root.join(".clawchat").join("CONTEXT.md");
    if is_regular_file(&pinned) {
        return vec![(".clawchat/CONTEXT.md".to_owned(), pinned)];
    }
    let mut files = Vec::new();
    files.extend(matching(root, "", "README"));
    files.extend(matching(&root.join("docs"), "docs/", "INDEX"));
    files.extend(matching(root, "", "WORKSPACE_INDEX"));
    files
}

/// Markdown files in `dir` whose name starts with `stem`, case-insensitively.
fn matching(dir: &Path, prefix: &str, stem: &str) -> Vec<(String, PathBuf)> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut found: Vec<(String, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let upper = name.to_ascii_uppercase();
            if !(upper.starts_with(stem) && upper.ends_with(".MD")) {
                return None;
            }
            let path = entry.path();
            if !is_regular_file(&path) {
                return None;
            }
            Some((format!("{prefix}{name}"), path))
        })
        .collect();
    found.sort();
    found
}

/// A real file reached without following a symlink: a link could point anywhere.
fn is_regular_file(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_file())
        .unwrap_or(false)
}

fn read_bounded(root: &Path, path: &Path) -> Option<String> {
    // The path was assembled under `root`, but a symlinked parent directory
    // could still lead out of it; resolve and check before reading.
    let resolved = path.canonicalize().ok()?;
    if !resolved.starts_with(root) {
        return None;
    }
    let bytes = fs::read(&resolved).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    Some(truncate(text.trim(), MAX_FILE_BYTES))
}

fn truncate(text: &str, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text.to_owned();
    }
    let mut end = max_bytes;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n…(truncated)", text[..end].trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, relative: &str, text: &str) {
        let path = root.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("parent");
        }
        fs::write(path, text).expect("write");
    }

    #[test]
    fn reads_readme_then_docs_index_then_workspace_index() {
        let dir = tempfile::tempdir().expect("tempdir");
        write(dir.path(), "README.md", "# E65");
        write(dir.path(), "docs/INDEX.md", "docs index");
        write(dir.path(), "WORKSPACE_INDEX.md", "workspace index");
        write(dir.path(), "NOTES.md", "not read");

        let files = read_context(dir.path().to_str().unwrap()).expect("context");

        let paths: Vec<&str> = files.iter().map(|file| file.path.as_str()).collect();
        assert_eq!(paths, ["README.md", "docs/INDEX.md", "WORKSPACE_INDEX.md"]);
        assert_eq!(files[0].text, "# E65");
    }

    #[test]
    fn a_curated_context_file_replaces_everything_else() {
        let dir = tempfile::tempdir().expect("tempdir");
        write(dir.path(), "README.md", "# E65");
        write(dir.path(), ".clawchat/CONTEXT.md", "Only this.");

        let files = read_context(dir.path().to_str().unwrap()).expect("context");

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, ".clawchat/CONTEXT.md");
        assert_eq!(files[0].text, "Only this.");
    }

    #[test]
    fn each_file_is_cut_and_the_total_is_bounded() {
        let dir = tempfile::tempdir().expect("tempdir");
        let big = "x".repeat(MAX_FILE_BYTES * 2);
        write(dir.path(), "README.md", &big);
        write(dir.path(), "README_A.md", &big);
        write(dir.path(), "README_B.md", &big);
        write(dir.path(), "README_C.md", &big);

        let files = read_context(dir.path().to_str().unwrap()).expect("context");

        assert!(files.iter().all(|file| file.text.ends_with("…(truncated)")));
        let total: usize = files.iter().map(|file| file.text.len()).sum();
        assert!(total <= MAX_TOTAL_BYTES);
        // Three cut files fit; the fourth would cross the ceiling and is dropped.
        assert_eq!(files.len(), 3);
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_not_followed() {
        let dir = tempfile::tempdir().expect("tempdir");
        let outside = tempfile::tempdir().expect("outside");
        write(outside.path(), "secret.md", "not for the server");
        std::os::unix::fs::symlink(outside.path().join("secret.md"), dir.path().join("README.md"))
            .expect("symlink");

        let files = read_context(dir.path().to_str().unwrap()).expect("context");

        assert!(files.is_empty());
    }

    #[test]
    fn a_missing_directory_is_an_error_not_an_empty_snapshot() {
        assert!(read_context("/definitely/not/here").is_err());
    }
}
