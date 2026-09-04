from fastapi.testclient import TestClient

from relay.main import app, broker


def test_relay_forwards_opaque_frames_both_directions():
    broker.hosts.clear()
    broker.clients.clear()
    broker._host_locks.clear()
    with (
        TestClient(app) as client,
        client.websocket_connect("/v1/relay/host/claw_test") as host,
        client.websocket_connect("/v1/relay/client/claw_test") as mobile,
    ):
        connected = host.receive_json()
        client_id = connected["client_id"]

        mobile.send_json({"kind": "encrypted", "ciphertext": "opaque"})
        forwarded = host.receive_json()
        assert forwarded == {
            "type": "client_frame",
            "client_id": client_id,
            "payload": {"kind": "encrypted", "ciphertext": "opaque"},
        }

        host.send_json({
            "client_id": client_id,
            "payload": {"kind": "encrypted", "ciphertext": "reply"},
        })
        assert mobile.receive_json() == {
            "kind": "encrypted",
            "ciphertext": "reply",
        }


def test_client_gets_explicit_offline_signal():
    broker.hosts.clear()
    with (
        TestClient(app) as client,
        client.websocket_connect("/v1/relay/client/missing") as mobile,
    ):
        assert mobile.receive_json() == {"kind": "host_offline"}
