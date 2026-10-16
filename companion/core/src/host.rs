use crate::{
    now,
    storage::{private_read, private_write, random_hex},
    validate_command, Request, Ticket, ALPN, MAX_REQUEST, MAX_RESPONSE, REQUEST_TIMEOUT, VERSION,
};
use anyhow::{ensure, Context, Result};
use iroh::{endpoint::presets, Endpoint, EndpointAddr, EndpointId, SecretKey};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    fs::{File, OpenOptions},
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use subtle::ConstantTimeEq;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::TcpStream,
    sync::{Mutex, Semaphore},
};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostState {
    pub version: u8,
    pub secret: String,
    pub devices: BTreeSet<String>,
}

pub struct Gate {
    path: PathBuf,
    pub state: HostState,
    invitation: Option<(String, u64)>,
}

impl Gate {
    pub fn load(path: PathBuf) -> Result<Self> {
        let state = if path.exists() {
            private_read(&path)?
        } else {
            let state = HostState {
                version: VERSION,
                secret: random_hex(),
                devices: BTreeSet::new(),
            };
            private_write(&path, &state)?;
            state
        };
        ensure!(state.version == VERSION, "Unsupported host state version");
        Ok(Self {
            path,
            state,
            invitation: None,
        })
    }

    pub fn invite(&mut self, host: EndpointAddr) -> Ticket {
        let invitation = random_hex();
        let expires = now() + 300;
        self.invitation = Some((invitation.clone(), expires));
        Ticket {
            version: VERSION,
            host,
            invitation,
            expires,
        }
    }

    pub fn cancel_invitation(&mut self) {
        self.invitation = None;
    }

    pub fn invitation_expiry(&self) -> Option<u64> {
        self.invitation
            .as_ref()
            .map(|(_, expires)| *expires)
            .filter(|expires| *expires > now())
    }

    pub fn pair(&mut self, peer: EndpointId, token: &str) -> Result<()> {
        // A lost pairing response is recoverable only by the same authenticated
        // identity; it cannot enroll a second device with an already-used ticket.
        if self.authorized(peer) {
            return Ok(());
        }
        ensure!(
            self.state.devices.len() < 16,
            "Device limit reached; revoke an old device"
        );
        let (expected, expiry) = self
            .invitation
            .as_ref()
            .context("Create a new invitation on the Mac")?;
        ensure!(
            *expiry > now() && bool::from(expected.as_bytes().ct_eq(token.as_bytes())),
            "Invalid or expired pairing invitation"
        );
        self.state.devices.insert(peer.to_string());
        if let Err(error) = private_write(&self.path, &self.state) {
            self.state.devices.remove(&peer.to_string());
            return Err(error);
        }
        self.invitation = None;
        Ok(())
    }

    pub fn authorized(&self, peer: EndpointId) -> bool {
        self.state.devices.contains(&peer.to_string())
    }

    pub fn revoke(&mut self, peer: &str) -> Result<()> {
        ensure!(self.state.devices.remove(peer), "Unknown device");
        // Keep revoked in memory on disk-write failure. Do not report success.
        private_write(&self.path, &self.state)
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Descriptor {
    version: u8,
    endpoint: String,
    token: String,
    application: String,
}

async fn desktop_request(
    descriptor: &Path,
    peer: EndpointId,
    request_id: &str,
    action: &str,
    input: Value,
) -> Result<Value> {
    let config: Descriptor = private_read(descriptor)?;
    ensure!(
        config.version == 1 && config.application == "com.monocode.companion-spike",
        "Not the isolated MonoCode bridge"
    );
    let address: SocketAddr = config.endpoint.parse()?;
    ensure!(
        address.ip() == IpAddr::V4(Ipv4Addr::LOCALHOST),
        "Desktop bridge must use loopback"
    );
    ensure!(
        config.token.len() == 64 && config.token.bytes().all(|c| c.is_ascii_hexdigit()),
        "Invalid desktop credential"
    );
    // Device namespaces prevent unrelated phones colliding in desktop receipts.
    // An image upload is bound to that same receipt ID, so namespace its private
    // upload token too. The phone never sees this desktop-only value.
    let namespaced_request_id = format!("{}-{request_id}", peer);
    let input = namespace_upload_id(input, action, &namespaced_request_id)?;
    let request = json!({"token": config.token, "namespace":"companion", "requestId":namespaced_request_id, "action":action, "input":input});
    let mut bytes = serde_json::to_vec(&request)?;
    ensure!(bytes.len() < MAX_REQUEST, "Request is too large");
    bytes.push(b'\n');
    let stream = TcpStream::connect(address)
        .await
        .context("Open MonoCode Companion Dev on the Mac")?;
    let (reader, mut writer) = stream.into_split();
    writer.write_all(&bytes).await?;
    let mut reader = BufReader::new(reader);
    let mut response = Vec::new();
    loop {
        let available = reader.fill_buf().await?;
        ensure!(
            !available.is_empty(),
            "Desktop closed without a receipt; command outcome unknown"
        );
        let end = available.iter().position(|&c| c == b'\n');
        let length = end.map_or(available.len(), |n| n + 1);
        ensure!(
            response.len() + length <= MAX_RESPONSE,
            "Desktop response is too large"
        );
        response.extend_from_slice(&available[..length]);
        reader.consume(length);
        if end.is_some() {
            break;
        }
    }
    Ok(serde_json::from_slice(&response)?)
}

fn namespace_upload_id(mut input: Value, action: &str, request_id: &str) -> Result<Value> {
    if !matches!(action, "sessions.send" | "sessions.attachment.upload") {
        return Ok(input);
    }
    let object = input
        .as_object_mut()
        .context("Invalid image request input")?;
    let Some(upload_id) = object.get_mut("uploadId") else {
        return Ok(input);
    };
    let raw = upload_id.as_str().context("Invalid image upload ID")?;
    let final_request_id = if action == "sessions.send" {
        ensure!(
            request_id.ends_with(&format!("-{raw}")),
            "Image upload ID does not match this device request"
        );
        request_id.to_owned()
    } else {
        let (peer, suffix) = request_id
            .rsplit_once(&format!("-{raw}-u"))
            .context("Image upload ID does not match this device request")?;
        let (index, offset) = suffix
            .split_once('-')
            .context("Invalid image upload request")?;
        ensure!(
            !index.is_empty()
                && !offset.is_empty()
                && index.bytes().all(|value| value.is_ascii_digit())
                && offset.bytes().all(|value| value.is_ascii_digit()),
            "Invalid image upload request"
        );
        format!("{peer}-{raw}")
    };
    *upload_id = Value::String(final_request_id);
    Ok(input)
}

pub struct Host {
    pub endpoint: Endpoint,
    pub gate: Arc<Mutex<Gate>>,
    pub descriptor: PathBuf,
    // The file stays on disk, while the OS releases its advisory lock if a
    // host crashes. This prevents the embedded host and the diagnostic CLI
    // from sharing one device identity at the same time.
    _lock: HostLock,
}

struct HostLock(File);

impl HostLock {
    fn acquire(state_path: &Path) -> Result<Self> {
        use fs2::FileExt;

        let directory = state_path
            .parent()
            .context("Missing host state directory")?;
        std::fs::create_dir_all(directory)?;
        let path = directory.join("host.lock");
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options.open(path)?;
        file.try_lock_exclusive()
            .context("Companion transport is already running in another MonoCode instance")?;
        Ok(Self(file))
    }
}

impl Drop for HostLock {
    fn drop(&mut self) {
        let _ = fs2::FileExt::unlock(&self.0);
    }
}

impl Host {
    pub async fn bind(state_path: PathBuf, descriptor: PathBuf, local_only: bool) -> Result<Self> {
        let lock = HostLock::acquire(&state_path)?;
        let gate = Gate::load(state_path)?;
        let key: SecretKey = gate.state.secret.parse()?;
        let mut builder = Endpoint::builder(presets::N0)
            .secret_key(key)
            .alpns(vec![ALPN.to_vec()]);
        if local_only {
            builder = builder
                .relay_mode(iroh::RelayMode::Disabled)
                .clear_address_lookup();
        }
        let endpoint = builder.bind().await?;
        Ok(Self {
            endpoint,
            gate: Arc::new(Mutex::new(gate)),
            descriptor,
            _lock: lock,
        })
    }

    pub async fn serve(&self) {
        let slots = Arc::new(Semaphore::new(16));
        while let Some(incoming) = self.endpoint.accept().await {
            let Ok(slot) = slots.clone().try_acquire_owned() else {
                incoming.refuse();
                continue;
            };
            let gate = self.gate.clone();
            let descriptor = self.descriptor.clone();
            tokio::spawn(async move {
                let _slot = slot;
                let _ = tokio::time::timeout(REQUEST_TIMEOUT, async {
                    let connection = incoming.await?;
                    let peer = connection.remote_id();
                    let (mut send, mut recv) = connection.accept_bi().await?;
                    let bytes = recv.read_to_end(MAX_REQUEST).await?;
                    let response = match handle(&gate, &descriptor, peer, &bytes).await {
                        Ok(value) => value,
                        Err(error) => json!({"ok":false,"error":error.to_string()}),
                    };
                    let bytes = serde_json::to_vec(&response)?;
                    ensure!(bytes.len() <= MAX_RESPONSE, "Response too large");
                    send.write_all(&bytes).await?;
                    send.finish()?;
                    let _ = send.stopped().await;
                    connection.close(0u8.into(), b"complete");
                    Ok::<(), anyhow::Error>(())
                })
                .await;
            });
        }
    }
}

async fn handle(
    gate: &Mutex<Gate>,
    descriptor: &Path,
    peer: EndpointId,
    bytes: &[u8],
) -> Result<Value> {
    let request: Request = serde_json::from_slice(bytes).context("Invalid protocol message")?;
    match request {
        Request::Pair {
            version,
            invitation,
        } => {
            ensure!(version == VERSION, "Unsupported protocol version");
            gate.lock().await.pair(peer, &invitation)?;
            Ok(json!({"ok":true,"result":{"paired":true,"deviceId":peer.to_string()}}))
        }
        Request::Command {
            version,
            request_id,
            action,
            input,
        } => {
            ensure!(version == VERSION, "Unsupported protocol version");
            validate_command(&request_id, &action, &input)?;
            // Hold the authorization lock until the desktop receipt arrives:
            // revoke waits for any already-accepted command, then blocks all new ones.
            let guard = gate.lock().await;
            ensure!(
                guard.authorized(peer),
                "Device is not paired or has been revoked"
            );
            match tokio::time::timeout(
                Duration::from_secs(38),
                desktop_request(descriptor, peer, &request_id, &action, input),
            )
            .await
            {
                Ok(Ok(value)) => Ok(value),
                Ok(Err(error)) => Ok(
                    json!({"ok":false,"outcomeUnknown":true,"error":format!("{error}. Command outcome unknown; retain the request ID")}),
                ),
                Err(_) => Ok(
                    json!({"ok":false,"outcomeUnknown":true,"error":"Desktop receipt timed out; command outcome unknown. Retry the same request ID"}),
                ),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn peer() -> EndpointId {
        random_hex().parse::<SecretKey>().unwrap().public()
    }

    #[test]
    fn invitation_is_single_use_persistent_and_revocable() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        let mut gate = Gate::load(path.clone()).unwrap();
        let host = peer();
        let first = peer();
        let other = peer();
        let ticket = gate.invite(host.into());
        assert!(gate.pair(first, "wrong").is_err());
        gate.pair(first, &ticket.invitation).unwrap();
        gate.pair(first, &ticket.invitation).unwrap();
        assert!(gate.pair(other, &ticket.invitation).is_err());
        assert!(Gate::load(path.clone()).unwrap().authorized(first));
        gate.revoke(&first.to_string()).unwrap();
        assert!(!Gate::load(path).unwrap().authorized(first));
        assert!(gate.pair(first, &ticket.invitation).is_err());
    }

    #[test]
    fn replacement_and_expiry_invalidate_old_invitation() {
        let dir = tempfile::tempdir().unwrap();
        let mut gate = Gate::load(dir.path().join("state.json")).unwrap();
        let old = gate.invite(peer().into());
        let current = gate.invite(old.host);
        assert!(gate.pair(peer(), &old.invitation).is_err());
        gate.cancel_invitation();
        assert!(gate.pair(peer(), &current.invitation).is_err());
        let current = gate.invite(peer().into());
        gate.invitation.as_mut().unwrap().1 = now() - 1;
        assert!(gate.pair(peer(), &current.invitation).is_err());
    }

    #[test]
    fn device_namespaces_image_upload_and_final_ids_together() {
        let first = "a".repeat(64);
        let second = "b".repeat(64);
        let input = json!({"uploadId":"same","id":"image","data":"abc"});
        let chunk = namespace_upload_id(
            input.clone(),
            "sessions.attachment.upload",
            &format!("{first}-same-u0-98304"),
        )
        .unwrap();
        let final_send =
            namespace_upload_id(input.clone(), "sessions.send", &format!("{first}-same")).unwrap();
        let other = namespace_upload_id(input, "sessions.send", &format!("{second}-same")).unwrap();
        assert_eq!(chunk["uploadId"], final_send["uploadId"]);
        assert_ne!(final_send["uploadId"], other["uploadId"]);
        assert!(namespace_upload_id(
            json!({"uploadId":"same"}),
            "sessions.attachment.upload",
            &format!("{first}-other-u0-0")
        )
        .is_err());
    }

    #[tokio::test]
    async fn only_one_host_can_own_a_state_directory() {
        let dir = tempfile::tempdir().unwrap();
        let state = dir.path().join("state.json");
        let descriptor = dir.path().join("descriptor.json");
        let host = Host::bind(state.clone(), descriptor.clone(), true)
            .await
            .unwrap();
        assert!(Host::bind(state.clone(), descriptor.clone(), true)
            .await
            .is_err());
        host.endpoint.close().await;
        drop(host);
        let replacement = Host::bind(state, descriptor, true).await.unwrap();
        replacement.endpoint.close().await;
    }
}
