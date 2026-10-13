//! Embedded lifecycle for the experimental phone companion transport.
//!
//! The Iroh host is intentionally owned by the desktop process.  It is never
//! a sidecar: stopping Remote access or quitting MonoCode closes the endpoint.

use serde::Serialize;
#[cfg(feature = "companion-spike")]
use std::time::Duration;
#[cfg(feature = "companion-spike")]
use tauri::Manager;
use tauri::{AppHandle, State};

#[derive(Default)]
pub struct CompanionNetwork {
    #[cfg(feature = "companion-spike")]
    inner: tokio::sync::Mutex<Inner>,
}

#[cfg(feature = "companion-spike")]
#[derive(Default)]
struct Inner {
    running: Option<Running>,
}

#[cfg(feature = "companion-spike")]
struct Running {
    host: std::sync::Arc<monocode_companion_core::host::Host>,
    task: tauri::async_runtime::JoinHandle<()>,
    invitation: Option<Invitation>,
}

#[cfg(feature = "companion-spike")]
struct Invitation {
    expires_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionDevice {
    pub id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionInvitationStatus {
    pub expires_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionNetworkStatus {
    pub available: bool,
    pub running: bool,
    pub host_id: Option<String>,
    /// Paired-device metadata is available only while the transport is on.
    /// The private host state is not opened merely to render an off-state UI.
    pub devices: Vec<CompanionDevice>,
    pub invitation: Option<CompanionInvitationStatus>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionInviteResult {
    #[serde(flatten)]
    pub status: CompanionNetworkStatus,
    /// This short-lived capability is returned only to the current webview so
    /// it can render a QR. It is never written to logs or persistent state.
    pub qr_data_url: String,
    pub expires_at: u64,
}

fn unavailable() -> CompanionNetworkStatus {
    CompanionNetworkStatus {
        available: false,
        running: false,
        host_id: None,
        devices: Vec::new(),
        invitation: None,
    }
}

#[cfg(feature = "companion-spike")]
fn require_experiment(app: &AppHandle) -> Result<(), String> {
    if app.config().identifier != "com.monocode.companion-spike" {
        return Err("Companion access requires the isolated development app".into());
    }
    Ok(())
}

#[cfg(feature = "companion-spike")]
async fn snapshot(running: &mut Running) -> CompanionNetworkStatus {
    use monocode_companion_core::now;

    let gate = running.host.gate.lock().await;
    let invitation_expiry = gate.invitation_expiry();
    let devices = gate
        .state
        .devices
        .iter()
        .cloned()
        .map(|id| CompanionDevice { id })
        .collect();
    drop(gate);
    if invitation_expiry.is_none() || invitation_expiry.is_some_and(|expiry| expiry <= now()) {
        running.invitation = None;
    }
    CompanionNetworkStatus {
        available: true,
        running: true,
        host_id: Some(running.host.endpoint.id().to_string()),
        devices,
        invitation: running
            .invitation
            .as_ref()
            .map(|invitation| CompanionInvitationStatus {
                expires_at: invitation.expires_at,
            }),
    }
}

#[tauri::command]
pub async fn companion_network_status(
    app: AppHandle,
    network: State<'_, CompanionNetwork>,
) -> Result<CompanionNetworkStatus, String> {
    #[cfg(feature = "companion-spike")]
    {
        if app.config().identifier != "com.monocode.companion-spike" {
            return Ok(unavailable());
        }
        let mut inner = network.inner.lock().await;
        Ok(match inner.running.as_mut() {
            Some(running) => snapshot(running).await,
            None => CompanionNetworkStatus {
                available: true,
                running: false,
                host_id: None,
                devices: Vec::new(),
                invitation: None,
            },
        })
    }
    #[cfg(not(feature = "companion-spike"))]
    {
        let _ = (app, network);
        Ok(unavailable())
    }
}

#[tauri::command]
pub async fn companion_network_start(
    window: tauri::WebviewWindow,
    app: AppHandle,
    network: State<'_, CompanionNetwork>,
) -> Result<CompanionNetworkStatus, String> {
    #[cfg(feature = "companion-spike")]
    {
        require_experiment(&app)?;
        crate::control::companion_enable(window, app.state())?;
        let mut inner = network.inner.lock().await;
        if let Some(running) = inner.running.as_mut() {
            return Ok(snapshot(running).await);
        }
        let data = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?;
        let host = monocode_companion_core::host::Host::bind(
            data.join("network").join("host.json"),
            data.join("companion-spike.json"),
            false,
        )
        .await
        .map_err(|error| error.to_string())?;
        if tokio::time::timeout(Duration::from_secs(20), host.endpoint.online())
            .await
            .is_err()
        {
            host.endpoint.close().await;
            return Err("Could not connect the companion relay. Check this Mac's internet connection and try again.".into());
        }
        let host = std::sync::Arc::new(host);
        let serving = host.clone();
        let task = tauri::async_runtime::spawn(async move { serving.serve().await });
        inner.running = Some(Running {
            host,
            task,
            invitation: None,
        });
        Ok(snapshot(inner.running.as_mut().expect("host installed")).await)
    }
    #[cfg(not(feature = "companion-spike"))]
    {
        let _ = (window, app, network);
        Err("Companion access requires the isolated development app".into())
    }
}

#[tauri::command]
pub async fn companion_network_stop(
    app: AppHandle,
    network: State<'_, CompanionNetwork>,
) -> Result<CompanionNetworkStatus, String> {
    #[cfg(feature = "companion-spike")]
    {
        require_experiment(&app)?;
        let running = network.inner.lock().await.running.take();
        stop_running(running).await;
        Ok(CompanionNetworkStatus {
            available: true,
            running: false,
            host_id: None,
            devices: Vec::new(),
            invitation: None,
        })
    }
    #[cfg(not(feature = "companion-spike"))]
    {
        let _ = (app, network);
        Err("Companion access requires the isolated development app".into())
    }
}

#[tauri::command]
pub async fn companion_network_invite(
    window: tauri::WebviewWindow,
    app: AppHandle,
    network: State<'_, CompanionNetwork>,
) -> Result<CompanionInviteResult, String> {
    #[cfg(feature = "companion-spike")]
    {
        use base64::{engine::general_purpose::STANDARD, Engine};
        use qrcode::{render::svg, QrCode};

        require_experiment(&app)?;
        crate::control::companion_enable(window, app.state())?;
        let mut inner = network.inner.lock().await;
        let running = inner
            .running
            .as_mut()
            .ok_or("Turn on Remote access before pairing a phone")?;
        let invitation = running
            .host
            .gate
            .lock()
            .await
            .invite(running.host.endpoint.addr());
        let expires_at = invitation.expires;
        let ticket = invitation.encode().map_err(|error| error.to_string())?;
        let code = QrCode::new(ticket.as_bytes()).map_err(|error| error.to_string())?;
        let svg = code.render::<svg::Color>().min_dimensions(480, 480).build();
        running.invitation = Some(Invitation { expires_at });
        let status = snapshot(running).await;
        Ok(CompanionInviteResult {
            status,
            qr_data_url: format!(
                "data:image/svg+xml;base64,{}",
                STANDARD.encode(svg.as_bytes())
            ),
            expires_at,
        })
    }
    #[cfg(not(feature = "companion-spike"))]
    {
        let _ = (window, app, network);
        Err("Companion access requires the isolated development app".into())
    }
}

#[tauri::command]
pub async fn companion_network_cancel_invite(
    app: AppHandle,
    network: State<'_, CompanionNetwork>,
) -> Result<CompanionNetworkStatus, String> {
    #[cfg(feature = "companion-spike")]
    {
        require_experiment(&app)?;
        let mut inner = network.inner.lock().await;
        let running = inner.running.as_mut().ok_or("Remote access is off")?;
        // Replacing the gate invitation invalidates the shown capability; do
        // not leave a usable ticket alive after the person cancels the UI.
        running.host.gate.lock().await.cancel_invitation();
        running.invitation = None;
        Ok(snapshot(running).await)
    }
    #[cfg(not(feature = "companion-spike"))]
    {
        let _ = (app, network);
        Err("Companion access requires the isolated development app".into())
    }
}

#[tauri::command]
pub async fn companion_network_revoke(
    app: AppHandle,
    network: State<'_, CompanionNetwork>,
    device_id: String,
) -> Result<CompanionNetworkStatus, String> {
    #[cfg(feature = "companion-spike")]
    {
        require_experiment(&app)?;
        if device_id.len() != 64 || !device_id.bytes().all(|value| value.is_ascii_hexdigit()) {
            return Err("Invalid paired device".into());
        }
        let mut inner = network.inner.lock().await;
        let running = inner.running.as_mut().ok_or("Remote access is off")?;
        running
            .host
            .gate
            .lock()
            .await
            .revoke(&device_id)
            .map_err(|error| error.to_string())?;
        Ok(snapshot(running).await)
    }
    #[cfg(not(feature = "companion-spike"))]
    {
        let _ = (app, network, device_id);
        Err("Companion access requires the isolated development app".into())
    }
}

#[cfg(feature = "companion-spike")]
async fn stop_running(running: Option<Running>) {
    if let Some(running) = running {
        running.task.abort();
        running.host.endpoint.close().await;
    }
}

pub fn shutdown(app: &AppHandle) {
    #[cfg(feature = "companion-spike")]
    if let Some(network) = app.try_state::<CompanionNetwork>() {
        let running =
            tauri::async_runtime::block_on(async { network.inner.lock().await.running.take() });
        tauri::async_runtime::block_on(stop_running(running));
    }
    #[cfg(not(feature = "companion-spike"))]
    let _ = app;
}
