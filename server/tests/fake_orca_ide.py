"""A stand-in for ``orca-ide`` that the runtime supervisor tests start.

It answers ``agent hooks status|off`` and ``serve`` the way Orca 1.4.267 does
where the supervisor looks: ``serve`` writes ``orca-runtime.json`` with a new
runtime id, listens on its unix socket, refuses a profile another runtime
holds (exit 78), and leaves the metadata file behind when it stops.

Behaviour is steered by files in the profile (``ORCA_USER_DATA_PATH``):

- ``fake-crash-first``: the first ``serve`` dies shortly after it is ready.
- ``fake-never-ready``: ``serve`` runs but never writes its metadata.
- ``fake-hooks-stay-on``: ``agent hooks off`` does not take.

Every call is appended to ``fake-calls.jsonl`` with its argv and the HOME it
ran with.
"""

import json
import os
import signal
import socket
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path

PROFILE = Path(os.environ["ORCA_USER_DATA_PATH"])


def record(argv: list[str]) -> None:
    entry = {
        "argv": argv,
        "home": os.environ.get("HOME"),
        "telemetry_disabled": os.environ.get("ORCA_TELEMETRY_DISABLED"),
        "do_not_track": os.environ.get("DO_NOT_TRACK"),
        "pid": os.getpid(),
    }
    with open(PROFILE / "fake-calls.jsonl", "a", encoding="utf-8") as calls:
        calls.write(json.dumps(entry) + "\n")


def answer(result) -> None:
    print(json.dumps({"id": "local", "ok": True, "result": result}))


def live_socket() -> bool:
    try:
        metadata = json.loads((PROFILE / "orca-runtime.json").read_text())
        endpoint = metadata["transports"][0]["endpoint"]
        with socket.socket(socket.AF_UNIX) as probe:
            probe.settimeout(1)
            probe.connect(endpoint)
        return True
    except (OSError, ValueError, KeyError, IndexError):
        return False


def serve() -> None:
    if live_socket():
        print("orcad: failed to start: Km [OrcadInstanceLockError]: Another orcad already owns the data root")
        sys.exit(78)
    serves = PROFILE / "fake-serve-count"
    count = int(serves.read_text()) + 1 if serves.exists() else 1
    serves.write_text(str(count))
    if (PROFILE / "fake-never-ready").exists():
        while True:
            time.sleep(1)

    # Short enough for a unix socket path; the tests remove what is listed.
    socket_dir = tempfile.mkdtemp(prefix="fo-", dir="/tmp")
    with open(PROFILE / "fake-socket-dirs", "a", encoding="utf-8") as listed:
        listed.write(socket_dir + "\n")
    socket_path = os.path.join(socket_dir, "o.sock")
    server = socket.socket(socket.AF_UNIX)
    server.bind(socket_path)
    server.listen(16)

    def stop(*_args):
        server.close()
        try:
            os.unlink(socket_path)
            os.rmdir(socket_dir)
        except OSError:
            pass
        os._exit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    runtime_id = str(uuid.uuid4())
    metadata = {
        "runtimeId": runtime_id,
        "pid": os.getpid(),
        "transports": [{"kind": "unix", "endpoint": socket_path}],
        "authToken": "fake-token",
    }
    (PROFILE / "orca-runtime.json").write_text(json.dumps(metadata))
    print(json.dumps({"type": "orca_server_ready", "runtimeId": runtime_id}), flush=True)

    if count == 1 and (PROFILE / "fake-crash-first").exists():

        def crash():
            time.sleep(0.3)
            print("orcad: fatal: simulated crash", flush=True)
            os._exit(1)

        threading.Thread(target=crash, daemon=True).start()

    while True:
        try:
            connection, _ = server.accept()
        except OSError:
            return
        with connection:
            data = b""
            connection.settimeout(1)
            try:
                while not data.endswith(b"\n"):
                    chunk = connection.recv(65536)
                    if not chunk:
                        break
                    data += chunk
            except OSError:
                continue
            if data.strip():
                request = json.loads(data)
                connection.sendall((json.dumps({"id": request.get("id"), "ok": True, "result": {}}) + "\n").encode())


def main() -> None:
    argv = sys.argv[1:]
    record(argv)
    words = [arg for arg in argv if not arg.startswith("--")]
    if words[:3] == ["agent", "hooks", "status"]:
        answer({"enabled": not (PROFILE / "fake-hooks-off").exists()})
    elif words[:3] == ["agent", "hooks", "off"]:
        if not (PROFILE / "fake-hooks-stay-on").exists():
            (PROFILE / "fake-hooks-off").write_text("off")
        answer({"enabled": not (PROFILE / "fake-hooks-off").exists()})
    elif words[:1] == ["serve"]:
        serve()
    elif words[:1] == ["status"]:
        answer({"runtime": {"reachable": live_socket()}})
    else:
        print(json.dumps({"ok": False, "error": {"code": "unknown", "message": " ".join(argv)}}))
        sys.exit(1)


if __name__ == "__main__":
    main()
