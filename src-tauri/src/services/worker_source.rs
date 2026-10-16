// Answering another device's request for a folder this machine offers.
//
// A data source is a folder on this disk -- an Obsidian vault, say -- that
// the user offered for reading. Home relays a phone's request here, this
// module answers it, and the answer goes back the same way. The server
// checks what was shared before asking; this side checks again, because only
// this side can see the disk: a symlink, a `..` the server missed, a hidden
// folder. The rules are the ones `worker_context` keeps for project folders:
// nothing is followed through a symlink, every path is resolved and checked
// against the root, and every answer is bounded.
//
// One change is possible: appending a task line to a `TODO.md`, after the
// user approved it in review. It is refused unless this machine's own
// setting allows changes to the folder -- the server's word is not enough --
// and it follows the same path rules, plus a size cap on the file.

use std::fs;
use std::io::{ErrorKind, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;

/// Most of a file one read hands back; the rest is cut and marked.
pub const MAX_READ_BYTES: usize = 512 * 1024;
const MAX_LIST_ENTRIES: usize = 5_000;
pub const MAX_INDEX_FILES: usize = 20_000;
const MAX_SEARCH_FILES: usize = 20_000;
const MAX_SEARCH_FILE_BYTES: u64 = 1024 * 1024;
const MAX_MATCHES: usize = 50;
const MAX_SNIPPET_CHARS: usize = 200;
const SEARCHABLE_EXTENSIONS: &[&str] = &["md", "markdown", "txt"];
/// Largest a `TODO.md` may grow by an append; past this it is refused.
pub const MAX_TODO_FILE_BYTES: u64 = 1024 * 1024;
/// Longest task line an append may add, prefix included.
const MAX_TASK_LINE_CHARS: usize = 512;
/// The only file an append may change, compared case-insensitively.
const TODO_FILE_NAME: &str = "todo.md";
const TASK_PREFIX: &str = "- [ ] ";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceQuery {
    /// The folder on this machine the source id maps to. Kept here, never
    /// sent to the server.
    pub root: String,
    pub op: String,
    /// Relative to `root`, `/`-separated.
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub include_folders: Vec<String>,
    #[serde(default)]
    pub exclude_folders: Vec<String>,
    /// This machine's own setting for the folder, never the server's. A write
    /// is refused without it.
    #[serde(default)]
    pub allow_writes: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceEntry {
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    /// Seconds since the Unix epoch.
    pub modified_at: Option<f64>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceMatch {
    pub path: String,
    pub snippet: Option<String>,
    pub line: Option<usize>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceAnswer {
    pub ok: bool,
    /// Why nothing was read, in a word the server matches on.
    pub error: Option<String>,
    pub entries: Vec<SourceEntry>,
    pub matches: Vec<SourceMatch>,
    pub content: Option<String>,
    pub truncated: bool,
}

impl SourceAnswer {
    fn refused(reason: &str) -> Self {
        SourceAnswer {
            ok: false,
            error: Some(reason.to_owned()),
            ..SourceAnswer::default()
        }
    }
}

/// The folders the user shared and the ones held back, NFC throughout:
/// macOS hands out decomposed names, the server and the phone composed ones.
struct Share {
    include: Vec<String>,
    exclude: Vec<String>,
}

fn nfc(text: &str) -> String {
    text.nfc().collect()
}

fn inside(path: &str, folder: &str) -> bool {
    folder.is_empty() || path == folder || path.starts_with(&format!("{folder}/"))
}

impl Share {
    fn new(include: &[String], exclude: &[String]) -> Self {
        let clean = |folders: &[String]| {
            folders
                .iter()
                .filter_map(|folder| relative_parts(folder).ok())
                .map(|parts| parts.join("/"))
                .collect::<Vec<_>>()
        };
        Share {
            include: clean(include),
            exclude: clean(exclude)
                .into_iter()
                .filter(|folder| !folder.is_empty())
                .collect(),
        }
    }

    fn excluded(&self, path: &str) -> bool {
        self.exclude.iter().any(|folder| inside(path, folder))
    }

    fn can_read(&self, path: &str) -> bool {
        !self.excluded(path)
            && (self.include.is_empty() || self.include.iter().any(|folder| inside(path, folder)))
    }

    fn leads_to_shared(&self, path: &str) -> bool {
        !self.excluded(path)
            && self
                .include
                .iter()
                .any(|folder| folder != path && inside(folder, path))
    }

    fn can_list(&self, path: &str) -> bool {
        self.can_read(path) || self.leads_to_shared(path)
    }
}

/// Split a requested path into plain names, refusing anything that could
/// leave the root or reach application state.
fn relative_parts(raw: &str) -> Result<Vec<String>, &'static str> {
    let text = nfc(raw.trim()).replace('\\', "/");
    if text.contains('\0') {
        return Err("invalid_path");
    }
    if text.starts_with('/') || text.starts_with('~') || text.as_bytes().get(1) == Some(&b':') {
        return Err("absolute_path");
    }
    let mut parts = Vec::new();
    for part in text.split('/') {
        match part {
            "" | "." => continue,
            ".." => return Err("outside_source"),
            hidden if hidden.starts_with('.') => return Err("hidden_path"),
            name => parts.push(name.to_owned()),
        }
    }
    Ok(parts)
}

/// The on-disk path for `parts` under `root`, reached without passing
/// through a symlink at any step.
fn resolve(root: &Path, parts: &[String]) -> Result<PathBuf, &'static str> {
    let mut current = root.to_path_buf();
    for part in parts {
        current.push(part);
        let metadata = fs::symlink_metadata(&current).map_err(|_| "not_found")?;
        if metadata.file_type().is_symlink() {
            return Err("symlink");
        }
    }
    // Every step was checked, but a root that moved underneath us is cheaper
    // to catch here than to reason about.
    let resolved = current.canonicalize().map_err(|_| "not_found")?;
    if !resolved.starts_with(root) {
        return Err("outside_source");
    }
    Ok(current)
}

fn modified_seconds(metadata: &fs::Metadata) -> Option<f64> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs_f64())
}

fn join(prefix: &str, name: &str) -> String {
    if prefix.is_empty() {
        name.to_owned()
    } else {
        format!("{prefix}/{name}")
    }
}

fn open_root(root: &str) -> Result<PathBuf, &'static str> {
    let requested = Path::new(root);
    if !requested.is_dir() {
        return Err("source_missing");
    }
    requested.canonicalize().map_err(|_| "source_missing")
}

/// Answer one relayed request. Refusals are answers too, so the server can
/// record why; only a malformed request is an `Err`.
pub fn query(request: &SourceQuery) -> SourceAnswer {
    if request.op == "append_todo" && !request.allow_writes {
        return SourceAnswer::refused("writes_not_allowed");
    }
    let root = match open_root(&request.root) {
        Ok(root) => root,
        Err(reason) => return SourceAnswer::refused(reason),
    };
    let parts = match relative_parts(&request.path) {
        Ok(parts) => parts,
        Err(reason) => return SourceAnswer::refused(reason),
    };
    let relative = parts.join("/");
    let share = Share::new(&request.include_folders, &request.exclude_folders);
    match request.op.as_str() {
        "list" => list(&root, &parts, &relative, &share),
        "read" => read(&root, &parts, &relative, &share),
        "search" => search(
            &root,
            &parts,
            &relative,
            &share,
            request.query.as_deref().unwrap_or(""),
        ),
        "append_todo" => append_todo(
            &root,
            &parts,
            &relative,
            &share,
            request.query.as_deref().unwrap_or(""),
        ),
        _ => SourceAnswer::refused("unknown_operation"),
    }
}

/// The one line an append adds: an unchecked task, nothing more. The server
/// builds it; this side refuses anything that could add a second line.
fn task_line(text: &str) -> Option<String> {
    let line = nfc(text.trim());
    let well_formed = line.starts_with(TASK_PREFIX)
        && line.len() > TASK_PREFIX.len()
        && !line.contains(['\n', '\r', '\0'])
        && line.chars().count() <= MAX_TASK_LINE_CHARS;
    well_formed.then_some(line)
}

/// Add `text` as the last line of the `TODO.md` at `parts`, creating the
/// file when its folder exists but it does not.
fn append_todo(
    root: &Path,
    parts: &[String],
    relative: &str,
    share: &Share,
    text: &str,
) -> SourceAnswer {
    let Some((name, folder)) = parts.split_last() else {
        return SourceAnswer::refused("not_found");
    };
    if name.to_lowercase() != TODO_FILE_NAME {
        return SourceAnswer::refused("not_todo_file");
    }
    if !share.can_read(relative) {
        return SourceAnswer::refused("not_shared");
    }
    let Some(line) = task_line(text) else {
        return SourceAnswer::refused("invalid_task");
    };
    let parent = match resolve(root, folder) {
        Ok(parent) => parent,
        Err(reason) => return SourceAnswer::refused(reason),
    };
    if !fs::symlink_metadata(&parent)
        .map(|metadata| metadata.is_dir())
        .unwrap_or(false)
    {
        return SourceAnswer::refused("not_found");
    }
    let file = parent.join(name);
    let outcome = match fs::symlink_metadata(&file) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err("symlink"),
        Ok(metadata) if !metadata.is_file() => Err("not_found"),
        Ok(metadata) => append_existing(&file, &metadata, &line),
        Err(error) if error.kind() == ErrorKind::NotFound => create_todo(&file, &line),
        Err(_) => Err("io_error"),
    };
    match outcome {
        Ok(()) => SourceAnswer {
            ok: true,
            ..SourceAnswer::default()
        },
        Err(reason) => SourceAnswer::refused(reason),
    }
}

fn append_existing(file: &Path, checked: &fs::Metadata, line: &str) -> Result<(), &'static str> {
    let mut handle = fs::OpenOptions::new()
        .read(true)
        .append(true)
        .open(file)
        .map_err(|_| "io_error")?;
    let opened = handle.metadata().map_err(|_| "io_error")?;
    // The name was checked to be a plain file; what got opened must be that
    // same file, not a symlink swapped in between the check and the open.
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if opened.dev() != checked.dev() || opened.ino() != checked.ino() {
            return Err("symlink");
        }
    }
    #[cfg(not(unix))]
    let _ = checked;
    if !opened.is_file() {
        return Err("not_found");
    }
    let length = opened.len();
    if length + line.len() as u64 + 2 > MAX_TODO_FILE_BYTES {
        return Err("too_large");
    }
    let mut head = Vec::with_capacity(8 * 1024);
    (&mut handle)
        .take(8 * 1024)
        .read_to_end(&mut head)
        .map_err(|_| "io_error")?;
    if head.contains(&0) {
        return Err("not_text");
    }
    let mut addition = String::with_capacity(line.len() + 2);
    if length > 0 {
        let mut last = [0u8; 1];
        handle
            .seek(SeekFrom::Start(length - 1))
            .and_then(|_| handle.read_exact(&mut last))
            .map_err(|_| "io_error")?;
        if last[0] != b'\n' {
            addition.push('\n');
        }
    }
    addition.push_str(line);
    addition.push('\n');
    handle
        .write_all(addition.as_bytes())
        .and_then(|_| handle.flush())
        .map_err(|_| "io_error")
}

fn create_todo(file: &Path, line: &str) -> Result<(), &'static str> {
    // `create_new` refuses whatever appeared at the name since the check,
    // a symlink included, instead of writing through it.
    let mut handle = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(file)
        .map_err(|error| {
            if error.kind() == ErrorKind::AlreadyExists {
                "symlink"
            } else {
                "io_error"
            }
        })?;
    handle
        .write_all(format!("{line}\n").as_bytes())
        .map_err(|_| "io_error")
}

fn list(root: &Path, parts: &[String], relative: &str, share: &Share) -> SourceAnswer {
    if !share.can_list(relative) {
        return SourceAnswer::refused("not_shared");
    }
    let folder = match resolve(root, parts) {
        Ok(folder) => folder,
        Err(reason) => return SourceAnswer::refused(reason),
    };
    let Ok(read_dir) = fs::read_dir(&folder) else {
        return SourceAnswer::refused("not_found");
    };
    let mut answer = SourceAnswer {
        ok: true,
        ..SourceAnswer::default()
    };
    for entry in read_dir.flatten() {
        let name = nfc(&entry.file_name().to_string_lossy());
        if name.starts_with('.') {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        let path = join(relative, &name);
        let is_dir = file_type.is_dir();
        let visible = share.can_read(&path) || (is_dir && share.leads_to_shared(&path));
        if !visible {
            continue;
        }
        if answer.entries.len() >= MAX_LIST_ENTRIES {
            answer.truncated = true;
            break;
        }
        let metadata = entry.metadata().ok();
        answer.entries.push(SourceEntry {
            path,
            is_dir,
            size: metadata
                .as_ref()
                .filter(|_| !is_dir)
                .map(|metadata| metadata.len()),
            modified_at: metadata.as_ref().and_then(modified_seconds),
        });
    }
    answer
        .entries
        .sort_by(|a, b| (!a.is_dir, &a.path).cmp(&(!b.is_dir, &b.path)));
    answer
}

fn read(root: &Path, parts: &[String], relative: &str, share: &Share) -> SourceAnswer {
    if relative.is_empty() {
        return SourceAnswer::refused("not_found");
    }
    if !share.can_read(relative) {
        return SourceAnswer::refused("not_shared");
    }
    let file = match resolve(root, parts) {
        Ok(file) => file,
        Err(reason) => return SourceAnswer::refused(reason),
    };
    if !fs::symlink_metadata(&file)
        .map(|metadata| metadata.file_type().is_file())
        .unwrap_or(false)
    {
        return SourceAnswer::refused("not_found");
    }
    let Ok(handle) = fs::File::open(&file) else {
        return SourceAnswer::refused("io_error");
    };
    let mut bytes = Vec::with_capacity(64 * 1024);
    if handle
        .take((MAX_READ_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .is_err()
    {
        return SourceAnswer::refused("io_error");
    }
    let truncated = bytes.len() > MAX_READ_BYTES;
    bytes.truncate(MAX_READ_BYTES);
    if bytes.iter().take(8 * 1024).any(|byte| *byte == 0) {
        return SourceAnswer::refused("not_text");
    }
    SourceAnswer {
        ok: true,
        content: Some(String::from_utf8_lossy(&bytes).into_owned()),
        truncated,
        ..SourceAnswer::default()
    }
}

/// Walk the shared part of the tree below `parts`, depth first, never
/// through a symlink or into a hidden or held-back folder.
fn walk<F>(root: &Path, parts: &[String], relative: &str, share: &Share, mut visit: F)
where
    F: FnMut(&Path, &str, &fs::Metadata) -> bool,
{
    let Ok(start) = resolve(root, parts) else {
        return;
    };
    let mut stack = vec![(start, relative.to_owned())];
    while let Some((folder, folder_relative)) = stack.pop() {
        let Ok(read_dir) = fs::read_dir(&folder) else {
            continue;
        };
        let mut children: Vec<_> = read_dir.flatten().collect();
        children.sort_by_key(|entry| entry.file_name());
        let mut folders = Vec::new();
        for entry in children {
            let name = nfc(&entry.file_name().to_string_lossy());
            if name.starts_with('.') {
                continue;
            }
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            let path = join(&folder_relative, &name);
            if file_type.is_dir() {
                if share.can_list(&path) {
                    folders.push((entry.path(), path));
                }
            } else if file_type.is_file() && share.can_read(&path) {
                let Ok(metadata) = entry.metadata() else {
                    continue;
                };
                if !visit(&entry.path(), &path, &metadata) {
                    return;
                }
            }
        }
        // Reversed so the stack pops them in name order.
        stack.extend(folders.into_iter().rev());
    }
}

fn search(
    root: &Path,
    parts: &[String],
    relative: &str,
    share: &Share,
    query: &str,
) -> SourceAnswer {
    let needle = nfc(query.trim()).to_lowercase();
    if needle.is_empty() {
        return SourceAnswer::refused("query_required");
    }
    if !share.can_list(relative) {
        return SourceAnswer::refused("not_shared");
    }
    if let Err(reason) = resolve(root, parts) {
        return SourceAnswer::refused(reason);
    }
    let mut answer = SourceAnswer {
        ok: true,
        ..SourceAnswer::default()
    };
    let mut scanned = 0usize;
    walk(root, parts, relative, share, |file, path, metadata| {
        if answer.matches.len() >= MAX_MATCHES || scanned >= MAX_SEARCH_FILES {
            answer.truncated = true;
            return false;
        }
        scanned += 1;
        let name = path.rsplit('/').next().unwrap_or(path).to_lowercase();
        if name.contains(&needle) {
            answer.matches.push(SourceMatch {
                path: path.to_owned(),
                ..SourceMatch::default()
            });
            return true;
        }
        let extension = Path::new(&name)
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("");
        if !SEARCHABLE_EXTENSIONS.contains(&extension) || metadata.len() > MAX_SEARCH_FILE_BYTES {
            return true;
        }
        let Ok(text) = fs::read_to_string(file) else {
            return true;
        };
        if let Some((number, line)) = text
            .lines()
            .enumerate()
            .find(|(_, line)| nfc(line).to_lowercase().contains(&needle))
        {
            answer.matches.push(SourceMatch {
                path: path.to_owned(),
                snippet: Some(line.trim().chars().take(MAX_SNIPPET_CHARS).collect()),
                line: Some(number + 1),
            });
        }
        true
    });
    answer
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexFile {
    pub path: String,
    pub size: u64,
    pub modified_at: Option<f64>,
}

/// Names and dates of the shared files, for Home to show while this machine
/// is off. Never contents.
pub fn index(
    root: &str,
    include_folders: &[String],
    exclude_folders: &[String],
) -> Result<Vec<IndexFile>, String> {
    let root = open_root(root).map_err(|_| format!("This machine has no folder at {root}."))?;
    let share = Share::new(include_folders, exclude_folders);
    let mut files = Vec::new();
    walk(&root, &[], "", &share, |_, path, metadata| {
        if files.len() >= MAX_INDEX_FILES {
            return false;
        }
        files.push(IndexFile {
            path: path.to_owned(),
            size: metadata.len(),
            modified_at: modified_seconds(metadata),
        });
        true
    });
    Ok(files)
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

    fn vault() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        write(dir.path(), "00_Inbox/TODO.md", "- [ ] Email Kim\n");
        write(
            dir.path(),
            "01_Projects/E65/TODO.md",
            "- [ ] Draft the abstract\n",
        );
        write(
            dir.path(),
            "01_Projects/E65/notes.md",
            "Meeting about E65 results\n",
        );
        write(
            dir.path(),
            "02_Resources/개인서류/passport.md",
            "passport number\n",
        );
        write(dir.path(), ".obsidian/workspace.json", "{}");
        dir
    }

    fn ask(root: &Path, op: &str, path: &str, include: &[&str], exclude: &[&str]) -> SourceAnswer {
        query(&SourceQuery {
            root: root.to_string_lossy().into_owned(),
            op: op.to_owned(),
            path: path.to_owned(),
            query: None,
            include_folders: include.iter().map(|s| s.to_string()).collect(),
            exclude_folders: exclude.iter().map(|s| s.to_string()).collect(),
            allow_writes: false,
        })
    }

    fn append(
        root: &Path,
        path: &str,
        line: &str,
        include: &[&str],
        exclude: &[&str],
        allow_writes: bool,
    ) -> SourceAnswer {
        query(&SourceQuery {
            root: root.to_string_lossy().into_owned(),
            op: "append_todo".to_owned(),
            path: path.to_owned(),
            query: Some(line.to_owned()),
            include_folders: include.iter().map(|s| s.to_string()).collect(),
            exclude_folders: exclude.iter().map(|s| s.to_string()).collect(),
            allow_writes,
        })
    }

    fn contents(root: &Path, relative: &str) -> String {
        fs::read_to_string(root.join(relative)).expect("read back")
    }

    #[test]
    fn appends_a_task_to_a_shared_todo() {
        let dir = vault();
        let answer = append(
            dir.path(),
            "00_Inbox/TODO.md",
            "- [ ] Draft the abstract",
            &["00_Inbox"],
            &[],
            true,
        );
        assert!(answer.ok, "{answer:?}");
        assert_eq!(
            contents(dir.path(), "00_Inbox/TODO.md"),
            "- [ ] Email Kim\n- [ ] Draft the abstract\n"
        );
    }

    #[test]
    fn a_file_without_a_last_newline_gets_one_before_the_task() {
        let dir = tempfile::tempdir().expect("tempdir");
        write(dir.path(), "TODO.md", "- [ ] First");
        assert!(append(dir.path(), "TODO.md", "- [ ] Second", &[], &[], true).ok);
        assert_eq!(
            contents(dir.path(), "TODO.md"),
            "- [ ] First\n- [ ] Second\n"
        );
    }

    #[test]
    fn a_missing_todo_is_created_in_an_existing_shared_folder() {
        let dir = vault();
        let answer = append(
            dir.path(),
            "01_Projects/E65/notes/TODO.md",
            "- [ ] x",
            &[],
            &[],
            true,
        );
        assert_eq!(answer.error.as_deref(), Some("not_found"));

        let created = append(dir.path(), "01_Projects/TODO.md", "- [ ] x", &[], &[], true);
        assert!(created.ok, "{created:?}");
        assert_eq!(contents(dir.path(), "01_Projects/TODO.md"), "- [ ] x\n");
    }

    #[test]
    fn nothing_is_written_unless_this_machine_allows_writes() {
        let dir = vault();
        let answer = append(dir.path(), "00_Inbox/TODO.md", "- [ ] x", &[], &[], false);
        assert_eq!(answer.error.as_deref(), Some("writes_not_allowed"));
        assert_eq!(
            contents(dir.path(), "00_Inbox/TODO.md"),
            "- [ ] Email Kim\n"
        );
    }

    #[test]
    fn writes_follow_the_read_rules_and_touch_only_todo_files() {
        let dir = vault();
        for (path, include, exclude, reason) in [
            ("01_Projects/E65/notes.md", vec![], vec![], "not_todo_file"),
            (
                "01_Projects/E65/TODO.md",
                vec!["00_Inbox"],
                vec![],
                "not_shared",
            ),
            (
                "02_Resources/개인서류/TODO.md",
                vec![],
                vec!["02_Resources/개인서류"],
                "not_shared",
            ),
            ("../TODO.md", vec![], vec![], "outside_source"),
            ("/tmp/TODO.md", vec![], vec![], "absolute_path"),
            (".obsidian/TODO.md", vec![], vec![], "hidden_path"),
            ("", vec![], vec![], "not_found"),
        ] {
            let answer = append(dir.path(), path, "- [ ] x", &include, &exclude, true);
            assert_eq!(answer.error.as_deref(), Some(reason), "{path}");
        }
        assert_eq!(
            contents(dir.path(), "01_Projects/E65/TODO.md"),
            "- [ ] Draft the abstract\n"
        );
        assert!(!dir.path().join("02_Resources/개인서류/TODO.md").exists());
    }

    #[test]
    fn decomposed_held_back_folders_are_never_written() {
        let dir = tempfile::tempdir().expect("tempdir");
        let decomposed: String = "개인서류".nfd().collect();
        write(
            dir.path(),
            &format!("{decomposed}/TODO.md"),
            "- [ ] secret\n",
        );
        let answer = append(
            dir.path(),
            "개인서류/TODO.md",
            "- [ ] x",
            &[],
            &["개인서류"],
            true,
        );
        assert_eq!(answer.error.as_deref(), Some("not_shared"));
    }

    #[test]
    fn only_one_unchecked_task_line_is_accepted() {
        let dir = vault();
        for line in [
            "- [ ] one\n- [ ] two",
            "- [ ] one\r# heading",
            "# heading",
            "- [ ] ",
            "plain text",
            &format!("- [ ] {}", "x".repeat(MAX_TASK_LINE_CHARS)),
        ] {
            let answer = append(dir.path(), "00_Inbox/TODO.md", line, &[], &[], true);
            assert_eq!(answer.error.as_deref(), Some("invalid_task"), "{line:?}");
        }
        assert_eq!(
            contents(dir.path(), "00_Inbox/TODO.md"),
            "- [ ] Email Kim\n"
        );
    }

    #[test]
    fn a_todo_past_the_size_cap_is_not_grown() {
        let dir = tempfile::tempdir().expect("tempdir");
        write(
            dir.path(),
            "TODO.md",
            &"x".repeat(MAX_TODO_FILE_BYTES as usize),
        );
        let answer = append(dir.path(), "TODO.md", "- [ ] x", &[], &[], true);
        assert_eq!(answer.error.as_deref(), Some("too_large"));
        assert_eq!(
            fs::metadata(dir.path().join("TODO.md")).unwrap().len(),
            MAX_TODO_FILE_BYTES
        );
    }

    #[test]
    fn a_binary_file_named_todo_is_not_appended_to() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("TODO.md"), b"\0\0binary").expect("write");
        let answer = append(dir.path(), "TODO.md", "- [ ] x", &[], &[], true);
        assert_eq!(answer.error.as_deref(), Some("not_text"));
    }

    #[cfg(unix)]
    #[test]
    fn writes_never_go_through_a_symlink() {
        let dir = vault();
        let outside = tempfile::tempdir().expect("outside");
        write(outside.path(), "TODO.md", "- [ ] outside\n");
        std::os::unix::fs::symlink(
            outside.path().join("TODO.md"),
            dir.path().join("01_Projects/TODO.md"),
        )
        .expect("file link");
        std::os::unix::fs::symlink(outside.path(), dir.path().join("00_Inbox/linked"))
            .expect("dir link");

        assert_eq!(
            append(dir.path(), "01_Projects/TODO.md", "- [ ] x", &[], &[], true)
                .error
                .as_deref(),
            Some("symlink")
        );
        assert_eq!(
            append(
                dir.path(),
                "00_Inbox/linked/TODO.md",
                "- [ ] x",
                &[],
                &[],
                true
            )
            .error
            .as_deref(),
            Some("symlink")
        );
        assert_eq!(contents(outside.path(), "TODO.md"), "- [ ] outside\n");
    }

    fn names(answer: &SourceAnswer) -> Vec<&str> {
        answer.entries.iter().map(|e| e.path.as_str()).collect()
    }

    #[test]
    fn lists_only_the_way_down_to_shared_folders() {
        let dir = vault();
        let answer = ask(dir.path(), "list", "", &["01_Projects"], &[]);
        assert!(answer.ok);
        assert_eq!(names(&answer), ["01_Projects"]);

        let projects = ask(dir.path(), "list", "01_Projects/E65", &["01_Projects"], &[]);
        assert_eq!(
            names(&projects),
            ["01_Projects/E65/TODO.md", "01_Projects/E65/notes.md"]
        );
        assert!(projects.entries.iter().all(|e| e.modified_at.is_some()));
    }

    #[test]
    fn reads_a_shared_file() {
        let dir = vault();
        let answer = ask(dir.path(), "read", "00_Inbox/TODO.md", &[], &[]);
        assert!(answer.ok, "{answer:?}");
        assert_eq!(answer.content.as_deref(), Some("- [ ] Email Kim\n"));
        assert!(!answer.truncated);
    }

    #[test]
    fn refuses_paths_that_leave_the_source_or_reach_app_state() {
        let dir = vault();
        for (path, reason) in [
            ("../outside.md", "outside_source"),
            ("00_Inbox/../../outside.md", "outside_source"),
            ("/etc/passwd", "absolute_path"),
            (".obsidian/workspace.json", "hidden_path"),
            ("00_Inbox/missing.md", "not_found"),
        ] {
            let answer = ask(dir.path(), "read", path, &[], &[]);
            assert_eq!(answer.error.as_deref(), Some(reason), "{path}");
            assert!(answer.content.is_none());
        }
    }

    #[test]
    fn held_back_folders_are_never_read_or_listed() {
        let dir = vault();
        let read = ask(
            dir.path(),
            "read",
            "02_Resources/개인서류/passport.md",
            &[],
            &["02_Resources/개인서류"],
        );
        assert_eq!(read.error.as_deref(), Some("not_shared"));

        let listing = ask(
            dir.path(),
            "list",
            "02_Resources",
            &[],
            &["02_Resources/개인서류"],
        );
        assert!(names(&listing).is_empty());
    }

    #[test]
    fn decomposed_names_on_disk_match_composed_rules() {
        let dir = tempfile::tempdir().expect("tempdir");
        let decomposed: String = "개인서류".nfd().collect();
        write(dir.path(), &format!("{decomposed}/a.md"), "secret");

        let read = ask(dir.path(), "read", "개인서류/a.md", &[], &["개인서류"]);
        assert_eq!(read.error.as_deref(), Some("not_shared"));
        let listing = ask(dir.path(), "list", "", &[], &["개인서류"]);
        assert!(names(&listing).is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_not_followed_anywhere() {
        let dir = vault();
        let outside = tempfile::tempdir().expect("outside");
        write(outside.path(), "secret.md", "not for anyone");
        std::os::unix::fs::symlink(
            outside.path().join("secret.md"),
            dir.path().join("00_Inbox/link.md"),
        )
        .expect("file link");
        std::os::unix::fs::symlink(outside.path(), dir.path().join("00_Inbox/linked"))
            .expect("dir link");

        assert_eq!(
            ask(dir.path(), "read", "00_Inbox/link.md", &[], &[])
                .error
                .as_deref(),
            Some("symlink")
        );
        assert_eq!(
            ask(dir.path(), "read", "00_Inbox/linked/secret.md", &[], &[])
                .error
                .as_deref(),
            Some("symlink")
        );
        let listing = ask(dir.path(), "list", "00_Inbox", &[], &[]);
        assert_eq!(names(&listing), ["00_Inbox/TODO.md"]);
        let files = index(dir.path().to_str().unwrap(), &[], &[]).expect("index");
        assert!(files.iter().all(|file| !file.path.contains("link")));
    }

    #[test]
    fn a_large_file_is_cut() {
        let dir = tempfile::tempdir().expect("tempdir");
        write(dir.path(), "big.md", &"x".repeat(MAX_READ_BYTES + 10));
        let answer = ask(dir.path(), "read", "big.md", &[], &[]);
        assert!(answer.truncated);
        assert_eq!(answer.content.unwrap().len(), MAX_READ_BYTES);
    }

    #[test]
    fn search_finds_names_and_lines_inside_shared_folders_only() {
        let dir = vault();
        let answer = query(&SourceQuery {
            root: dir.path().to_string_lossy().into_owned(),
            op: "search".to_owned(),
            path: String::new(),
            query: Some("e65".to_owned()),
            include_folders: vec!["01_Projects".to_owned()],
            exclude_folders: vec![],
            allow_writes: false,
        });
        assert!(answer.ok);
        let found: Vec<_> = answer
            .matches
            .iter()
            .map(|m| (m.path.as_str(), m.line))
            .collect();
        assert_eq!(found, [("01_Projects/E65/notes.md", Some(1))]);

        let private = query(&SourceQuery {
            root: dir.path().to_string_lossy().into_owned(),
            op: "search".to_owned(),
            path: String::new(),
            query: Some("passport".to_owned()),
            include_folders: vec![],
            exclude_folders: vec!["02_Resources/개인서류".to_owned()],
            allow_writes: false,
        });
        assert!(private.matches.is_empty());
    }

    #[test]
    fn the_index_has_shared_files_without_hidden_ones() {
        let dir = vault();
        let files = index(
            dir.path().to_str().unwrap(),
            &[],
            &["02_Resources/개인서류".to_owned()],
        )
        .expect("index");
        let paths: Vec<_> = files.iter().map(|file| file.path.as_str()).collect();
        assert_eq!(
            paths,
            [
                "00_Inbox/TODO.md",
                "01_Projects/E65/TODO.md",
                "01_Projects/E65/notes.md"
            ]
        );
    }

    #[test]
    fn a_missing_root_is_reported_as_such() {
        let answer = ask(Path::new("/definitely/not/here"), "list", "", &[], &[]);
        assert_eq!(answer.error.as_deref(), Some("source_missing"));
    }
}
