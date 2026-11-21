# ADR 021: A desktop host keeps serving without a desktop session

## Status

Accepted

## Context

In host mode, the desktop app's Rust shell starts the bundled server and stops
it when the app quits (`src-tauri/src/services/server_supervisor.rs`). The
server therefore lives only as long as a logged-in desktop session. That is
fine for a laptop that serves itself. It is not fine for a machine that phones
and desktop workers depend on.

That happened from 2026-11-14 to 2026-11-21. A Linux desktop served as the
user's Home server for a phone and a MacBook worker. Its desktop session ended
and the app got SIGTERM, so the server stopped with it. Nothing could bring it
back: a Tauri app cannot start without a desktop session, and there was no
autostart entry. Home stayed down for a week, and nobody noticed.

Three approaches were weighed:

1. **A systemd unit that runs the extracted server directly**, with HOST,
   PORT, PIN and paths written in an env file. Rejected because every
   upgrade means extracting the AppImage again. The PIN and port would also
   live in two places, the app's settings and the env file, and the env file
   would drift from what the shell sets.
2. **A `--server-only` mode of the desktop binary**, which runs the same
   server with the same settings and environment, without a window. Chosen.
3. **The window connects to a server that is already running** instead of
   starting its own. This is needed with any standalone server, so it is part
   of the decision.

Before this change, the shell reused any healthy ClawChat server on the
configured port, and otherwise started its own on a free port. A standalone
server broke that in two ways:

- The server binds its port only after migrations. A window opened during
  that time saw the port free and started a second server on another port,
  against the same database.
- The shell stopped a reused server when it quit, so quitting the window
  would have stopped the standalone server too.

## Decision

### One server per database, enforced by the server

`server/services/database_lock.py` takes an exclusive OS lock on `<db>.lock`
before `init_db` touches the database. The lock is `flock` on Linux and macOS
and `msvcrt.locking` on Windows. The server then records itself in
`<db>.owner.json`: pid, bind host, port, `SERVER_OWNER`, version and start
time.

- The OS drops the lock when the process dies, so a crash never leaves it
  stale. The owner record is only meaningful while the lock is held, and a
  clean shutdown deletes it.
- The packaged entry point (`run_server.py`) claims the database before
  uvicorn starts. A second server exits with one line, `ClawChat database in
  use: …`, and code 75. The lifespan claims again, which covers `uvicorn
  main:app`, Docker and anything else. There, a conflict fails startup with
  the same message and uvicorn's exit code 3.
- Non-SQLite and in-memory URLs are not locked. On a filesystem that cannot
  lock at all, the server logs a warning and runs unguarded, as it did before
  this ADR.
- `SERVER_OWNER` says who started the server: `desktop` (the window),
  `service` (`--server-only`) or `standalone` (the default).

The guard sits in the server, not the shell, because only the server is
present on every path to the database.

### `--server-only`

`clawchat-tauri --server-only [--data-dir <folder>]` runs the bundled server
in place of the window. On Linux that is `ClawChat.AppImage --server-only`.

- **No desktop session needed.** The flag is parsed in `run()` before the
  Tauri builder. Nothing touches GTK, opens a window or claims the
  single-instance name.
- **Same folders, settings and environment as the window.** The data folder
  layout is `NativePaths::in_app_data_dir`. The settings come from the same
  `server-config.json`, so the port, PIN and LAN access set in the app apply.
  The command and environment come from `ServerSupervisor::server_process`,
  the same function the window's `spawn` uses. Only `SERVER_OWNER` differs.
- **Refuses a broken setup.** An unreadable config, an invalid PIN or LAN
  setting, or the automatic port (`0`) exits with code 78. Phones need a
  fixed port.
- **Waits rather than fails.** While another process holds the database,
  the launcher waits. It checks every 2 s and says once who holds it. Usually
  that is the window's own server, and the service takes over as soon as the
  window quits.
- **Becomes the server.** On Unix the launcher `exec`s the server, so
  systemd's main PID, signals and exit status are the server's own. The
  server's output is appended to the same `server.log` as the window's. The
  launcher's own lines go to stderr, which is the service's journal.

A systemd **user** unit with `loginctl enable-linger` runs it from boot
(`docs/deployment.md`). The unit needs `Restart=always`: see the window's
restart below.

### The window connects

When the window starts, the supervisor checks the database lock before
anything else.

- **Held.** It waits for the holder's port, from the owner record, to answer
  `/api/health`. It allows the same 60 s it gives its own server. Then it
  uses that server.
  - The holder was started by the desktop (`SERVER_OWNER=desktop`): an
    earlier launch crashed and left it behind. The window adopts it and stops
    it on quit, as before.
  - Anyone else's server is **external**. The window never stops it. Quitting
    or turning the local server off only lets go.
- **Free.** It starts its own server. If that server exits with the
  "database in use" line, someone claimed the database in between, and the
  window connects to them instead.
- **Restart.** Changing the PIN, port or LAN access restarts the server. With
  an external server, the window sends SIGTERM to that pid only, never its
  process group, which may be someone else's shell. It waits up to 15 s for
  the lock to clear, then starts as above. Whoever claims next reads the
  settings just saved. That is the window, if it gets there first, or the
  service, once systemd starts it again.

The earlier reuse by port stays. It covers a server left behind by a version
from before this lock.

## Consequences

- At most one server runs per database file, whatever started it. That
  includes Docker and servers started by hand.
- A Linux host with the service serves from boot. Logging in, the window uses
  that server, and logging out leaves it running. If the window's own server
  came first, the service takes over within a few seconds of the window
  quitting.
- The service runs whatever AppImage its unit names. An in-app update replaces
  that file, but the running server keeps the old version until
  `systemctl --user restart clawchat`. The window does not restart a service
  server whose version differs.
- An AppImage runs from a FUSE mount whose helper lives in the service's
  cgroup. When the server exits on its own (a settings restart from the
  window, or a crash), systemd ends the helper before it unmounts, and a dead
  `/tmp/.mount_ClawCh…` stays until reboot. `systemctl stop` does not leave
  one, and neither `KillMode=mixed` nor `control-group` avoids it.
  `APPIMAGE_EXTRACT_AND_RUN` avoids it but extracts into `/tmp`, which is
  cleaned after 30 days under a running server, and forks instead of
  `exec`ing. The leftover mount is the smaller cost.
- The shell's lock probe holds the lock for an instant. A server that starts
  at that moment exits as "in use", and its launcher retries: the window
  connects, systemd restarts.
- The lock is advisory. `sqlite3`, backups and other direct readers are not
  blocked, and WAL keeps them safe for reading.
- `--server-only` also runs on macOS and Windows, where it spawns and waits
  instead of `exec`. Only the Linux systemd setup is documented.
