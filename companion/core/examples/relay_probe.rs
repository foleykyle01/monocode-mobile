//! Read-only diagnostic over the public relay with direct IP transports disabled.
//! Uses a disposable device identity; revoke the printed public device ID afterward.
use anyhow::{Context, Result};
use iroh::{endpoint::presets, Endpoint, SecretKey};
use monocode_companion_core::{exchange, require_ok, Request, Ticket, VERSION};
use serde_json::json;

#[tokio::main]
async fn main() -> Result<()> {
    let path = std::env::args()
        .nth(1)
        .context("Pass the private pairing.txt path")?;
    let ticket = Ticket::decode(&std::fs::read_to_string(path)?)?;
    let endpoint = Endpoint::builder(presets::N0)
        .secret_key(SecretKey::generate())
        .clear_ip_transports()
        .bind()
        .await?;
    println!("Disposable device ID: {}", endpoint.id());
    let paired = exchange(
        &endpoint,
        &ticket.host,
        &Request::Pair {
            version: VERSION,
            invitation: ticket.invitation,
        },
    )
    .await?;
    require_ok(&paired)?;
    let response = exchange(
        &endpoint,
        &ticket.host,
        &Request::Command {
            version: VERSION,
            request_id: "relay-probe".into(),
            action: "sessions.list".into(),
            input: json!({}),
        },
    )
    .await?;
    require_ok(&response)?;
    println!(
        "Relay-only encrypted session read succeeded ({} sessions).",
        response["result"]["sessions"]
            .as_array()
            .context("Invalid desktop response")?
            .len()
    );
    endpoint.close().await;
    Ok(())
}
