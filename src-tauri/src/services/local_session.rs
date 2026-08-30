use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    time::Duration,
};

use crate::models::LocalSession;

const LOCAL_SESSION_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_LOCAL_SESSION_RESPONSE_BYTES: u64 = 64 * 1024;

/// Exchange the native-only local PIN for a normal renderer session.
///
/// Keeping this HTTP exchange in Rust means `server_get_config` can return a
/// redacted view and the local PIN never has to enter the webview JavaScript
/// heap. The endpoint remains the server's ordinary login contract, so token
/// rotation and logout continue to work exactly like a remote session.
pub fn issue_local_session(port: u16, pin: &str) -> Result<LocalSession, String> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&address, LOCAL_SESSION_TIMEOUT)
        .map_err(|error| format!("failed to connect to the local workspace: {error}"))?;
    stream
        .set_read_timeout(Some(LOCAL_SESSION_TIMEOUT))
        .map_err(|error| format!("failed to configure local session timeout: {error}"))?;
    stream
        .set_write_timeout(Some(LOCAL_SESSION_TIMEOUT))
        .map_err(|error| format!("failed to configure local session timeout: {error}"))?;

    let body = serde_json::json!({ "pin": pin }).to_string();
    let request = format!(
        "POST /api/auth/login HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("failed to request a local session: {error}"))?;

    let mut response = Vec::new();
    stream
        .take(MAX_LOCAL_SESSION_RESPONSE_BYTES)
        .read_to_end(&mut response)
        .map_err(|error| format!("failed to read the local session response: {error}"))?;
    let response = String::from_utf8_lossy(&response);
    let (headers, body) = response
        .split_once("\r\n\r\n")
        .ok_or_else(|| "local workspace returned an invalid HTTP response".to_owned())?;
    if !(headers.starts_with("HTTP/1.1 200") || headers.starts_with("HTTP/1.0 200")) {
        let detail = serde_json::from_str::<serde_json::Value>(body)
            .ok()
            .and_then(|payload| {
                payload
                    .pointer("/error/message")
                    .or_else(|| payload.get("detail"))
                    .and_then(|value| value.as_str())
                    .map(str::to_owned)
            })
            .unwrap_or_else(|| "local workspace refused the protected session request".to_owned());
        return Err(detail);
    }
    serde_json::from_str(body)
        .map_err(|error| format!("local workspace returned an invalid session: {error}"))
}

#[cfg(test)]
mod tests {
    use std::{net::TcpListener, thread};

    use super::*;

    #[test]
    fn native_pin_exchange_returns_only_session_tokens() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("listener");
        let port = listener.local_addr().expect("address").port();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("connection");
            let mut request = [0_u8; 2048];
            let read = stream.read(&mut request).expect("request");
            let request = String::from_utf8_lossy(&request[..read]);
            assert!(request.contains(r#"{"pin":"654321"}"#));
            let body = r#"{"access_token":"access","refresh_token":"refresh"}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).expect("response");
        });

        let session = issue_local_session(port, "654321").expect("local session");

        assert_eq!(session.access_token, "access");
        assert_eq!(session.refresh_token.as_deref(), Some("refresh"));
        server.join().expect("server thread");
    }

    #[test]
    fn native_pin_exchange_preserves_a_server_rejection() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("listener");
        let port = listener.local_addr().expect("address").port();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("connection");
            let mut request = [0_u8; 2048];
            let _ = stream.read(&mut request);
            let body = r#"{"error":{"message":"Invalid PIN"}}"#;
            let response = format!(
                "HTTP/1.1 401 Unauthorized\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).expect("response");
        });

        assert_eq!(
            issue_local_session(port, "wrong").expect_err("rejection"),
            "Invalid PIN"
        );
        server.join().expect("server thread");
    }
}
