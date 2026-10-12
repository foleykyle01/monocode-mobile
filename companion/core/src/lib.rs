//! Versioned device transport. Provider credentials and execution remain in the desktop.
pub mod host;
pub mod storage;

use anyhow::{bail, ensure, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use iroh::{endpoint::presets, Endpoint, EndpointAddr, SecretKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const ALPN: &[u8] = b"monocode/companion/1";
pub const VERSION: u8 = 1;
pub const MAX_REQUEST: usize = 262_144;
pub const MAX_RESPONSE: usize = 4 * 1024 * 1024;
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(45);

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Ticket {
    pub version: u8,
    pub host: EndpointAddr,
    pub invitation: String,
    pub expires: u64,
}

impl Ticket {
    pub fn encode(&self) -> Result<String> {
        Ok(format!(
            "monocode-companion://pair/{}",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(self)?)
        ))
    }

    pub fn decode(text: &str) -> Result<Self> {
        ensure!(text.len() <= 16_384, "Pairing invitation is too large");
        let encoded = text
            .trim()
            .strip_prefix("monocode-companion://pair/")
            .context("Paste a MonoCode pairing invitation")?;
        let ticket: Self = serde_json::from_slice(
            &URL_SAFE_NO_PAD
                .decode(encoded)
                .context("Invalid invitation")?,
        )?;
        ensure!(ticket.version == VERSION, "Unsupported pairing version");
        ensure!(
            ticket.expires > now(),
            "Pairing invitation expired. Create another on the Mac"
        );
        ensure!(
            ticket.invitation.len() == 64
                && ticket.invitation.bytes().all(|c| c.is_ascii_hexdigit()),
            "Invalid invitation"
        );
        Ok(ticket)
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Request {
    Pair {
        version: u8,
        invitation: String,
    },
    Command {
        version: u8,
        #[serde(rename = "requestId")]
        request_id: String,
        action: String,
        input: Value,
    },
}

pub fn validate_command(request_id: &str, action: &str, input: &Value) -> Result<()> {
    ensure!(
        !request_id.is_empty()
            && request_id.len() <= 56
            && request_id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-'),
        "Invalid request ID"
    );
    ensure!(
        matches!(
            action,
            "sessions.list"
                | "sessions.read"
                | "sessions.send"
                | "sessions.approve"
                | "sessions.stop"
                | "sessions.configure"
                | "sessions.create"
                | "inbox.list"
                | "inbox.read"
                | "changes.list"
                | "changes.read"
                | "monos.read"
        ),
        "Unsupported companion action"
    );
    ensure!(input.is_object(), "Input must be an object");
    Ok(())
}

/// The endpoint key is supplied by native secure storage. It never enters the UI.
pub async fn client_endpoint(key: SecretKey) -> Result<Endpoint> {
    Ok(Endpoint::builder(presets::N0)
        .secret_key(key)
        .bind()
        .await?)
}

/// One bounded request per connection. Reads may be retried by callers; mutations
/// must retain their exact request ID and payload after an uncertain outcome.
pub async fn exchange(
    endpoint: &Endpoint,
    host: &EndpointAddr,
    request: &Request,
) -> Result<Value> {
    let bytes = serde_json::to_vec(request)?;
    ensure!(bytes.len() <= MAX_REQUEST, "Request is too large");
    let connection = tokio::time::timeout(
        Duration::from_secs(15),
        endpoint.connect(host.clone(), ALPN),
    )
    .await
    .context("Mac is unreachable. Retry when connected")??;
    let result = tokio::time::timeout(REQUEST_TIMEOUT, async {
        let (mut send, mut recv) = connection.open_bi().await?;
        send.write_all(&bytes).await?;
        send.finish()?;
        let bytes = recv.read_to_end(MAX_RESPONSE).await?;
        Ok::<Value, anyhow::Error>(serde_json::from_slice(&bytes)?)
    })
    .await;
    connection.close(0u8.into(), b"complete");
    result.context(
        "Response timed out. A command may have run; keep the same request ID when retrying",
    )?
}

pub fn require_ok(response: &Value) -> Result<()> {
    if response.get("ok").and_then(Value::as_bool) != Some(true) {
        bail!(
            "{}",
            response
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("Mac rejected the request")
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unknown_command_and_malformed_input() {
        assert!(validate_command("abc", "sessions.list", &serde_json::json!({})).is_ok());
        assert!(validate_command("abc", "shell.exec", &serde_json::json!({})).is_err());
        assert!(validate_command("bad:id", "sessions.send", &serde_json::json!({})).is_err());
        assert!(validate_command("abc", "sessions.configure", &serde_json::json!({})).is_ok());
        assert!(validate_command("abc", "sessions.create", &serde_json::json!({})).is_ok());
        for action in [
            "inbox.list",
            "inbox.read",
            "changes.list",
            "changes.read",
            "monos.read",
        ] {
            assert!(
                validate_command("abc", action, &serde_json::json!({})).is_ok(),
                "{action}"
            );
        }
        for action in [
            "inbox.start",
            "changes.stage",
            "changes.unstage",
            "changes.commit",
        ] {
            assert!(
                validate_command("abc", action, &serde_json::json!({})).is_err(),
                "{action}"
            );
        }
        assert!(validate_command("abc", "sessions.read", &serde_json::json!([])).is_err());
    }
}
