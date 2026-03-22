# Obsidian CLI Contract

Reference document for the Obsidian CLI integration in ClawChat.
Defines the expected arguments, return formats, failure modes, and path rules.

## CLI Binary

- Configured via `OBSIDIAN_CLI_COMMAND` environment variable
- Working directory set to `OBSIDIAN_VAULT_PATH` on every invocation
- Default timeout: 15 seconds (5s for health checks, 10s for search)

## Commands

### `version`
Health check / CLI availability probe.
```
obsidian version
```
- **Returns**: Version string on stdout
- **Exit 0**: CLI is available
- **Used by**: `is_cli_available()`, vault indexer refresh

### `create path=<path> content=<text>`
Create a new markdown document.
```
obsidian create path=Projects/foo/README.md content=# Hello World
```
- **Arguments**:
  - `path` — vault-relative path (forward slashes, no leading `/`, no `..`)
  - `content` — document body (may contain `=` characters)
- **Exit 0**: Document created successfully
- **Non-zero**: Creation failed (file exists, permission error, etc.)
- **Fallback**: Filesystem write via `os.makedirs` + `open(..., "w")`

### `append path=<path> content=<text>`
Append content to an existing document (creates if missing).
```
obsidian append path=Projects/foo/TODO.md content=- New item
```
- **Arguments**: Same as `create`
- **Exit 0**: Content appended
- **Fallback**: Filesystem `open(..., "a")`

### `rename path=<path> name=<new_name>`
Rename a document. CLI preferred because it updates internal wiki links.
```
obsidian rename path=Projects/foo/old.md name=new.md
```
- **Arguments**:
  - `path` — current vault-relative path
  - `name` — new filename only (not a path)
- **Exit 0**: Renamed with link updates
- **Fallback**: `os.rename` (no link update)

### `move path=<path> to=<new_path>`
Move a document to a different folder. CLI preferred for link updates.
```
obsidian move path=Projects/foo/doc.md to=Archive/foo/doc.md
```
- **Arguments**:
  - `path` — current vault-relative path
  - `to` — new vault-relative path (including filename)
- **Exit 0**: Moved with link updates
- **Fallback**: `shutil.move` (no link update)

### `search query=<text>`
Full-text vault search.
```
obsidian search query=meeting notes
```
- **Returns**: One file path per line on stdout (up to 10 results)
- **Fallback**: Filename substring match via `os.walk`

### `files folder=<path>`
List vault files in a folder.
```
obsidian files folder=Projects/foo
```
- **Returns**: File paths on stdout
- **Used by**: Context service for project file listing

### `commands`
List available CLI plugin commands.
```
obsidian commands
```
- **Returns**: One command ID per line

### `command id=<command_id>`
Execute a specific plugin command.
```
obsidian command id=daily-notes:open-today
```

## Path Rules

All vault-relative paths MUST:
1. Use forward slashes (`/`)
2. NOT start with `/` (leading slashes are stripped)
3. NOT contain `..` segments (rejected with `ValueError`)
4. Be relative to the vault root (absolute paths are not accepted)

Path normalization is applied automatically by `_normalize_vault_path()`:
- `\` → `/`
- Leading `/` stripped
- `..` segments cause `ValueError`

## Failure Modes

| Failure | Behavior |
|---------|----------|
| CLI binary not found | `FileNotFoundError` → logged, returns `None` |
| CLI timeout (>15s) | `TimeoutExpired` → logged, returns `None` |
| CLI non-zero exit | Logged with stderr, returns `None` |
| Filesystem write fails | `OSError` → logged, optionally queued |
| Both CLI + FS fail | Queued if `companion_node_required=True` |

## Write Queue

- **Queue file**: `data/obsidian_write_queue.json`
- **Dead letter file**: `data/obsidian_dead_letter.json`
- **Max retries**: 10 (then moved to dead letter)
- **Backoff**: `min(60 × 2^retries, 3600)` seconds
- **Auto-flush**: Every 60 seconds via scheduler
- **Concurrency**: Protected by `threading.Lock`
- **Persistence**: Both queues survive server restarts

## Sync Modes

| Mode | Behavior |
|------|----------|
| `filesystem` | CLI-first with filesystem fallback (default) |
| `livesync` | Same as filesystem; LiveSync plugin handles CouchDB replication externally |
| `disabled` | All write/scan operations return `False` / no-op |

## Error Tracking

- **Ring buffer**: Last 50 CLI errors stored in memory
- **Fields**: `timestamp`, `command`, `error`, `returncode`
- **API**: `GET /api/obsidian/cli-errors`
- **Last success**: `_last_successful_cli_at` timestamp tracked separately
