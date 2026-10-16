mod attachments;
mod pending;

use anyhow::{ensure, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use iroh::{Endpoint, EndpointAddr, SecretKey};
use monocode_companion_core::{
    client_endpoint, exchange, require_ok, storage::random_hex, validate_command, Request, Ticket,
    VERSION,
};
use pending::{definitive_response, is_mutation, PendingCommand};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

const SERVICE: &str = "dev.monocode.companion";
const ACCOUNT: &str = "device-identity-v1";
const PENDING_ACCOUNT: &str = "pending-command-v1";

fn attachment_directory(app: &AppHandle) -> Result<std::path::PathBuf> {
    Ok(app.path().app_data_dir()?.join("companion-pending-images"))
}

fn clear_staged_attachments(app: &AppHandle, input: &Value) {
    let Ok(references) = attachments::references(input) else {
        return;
    };
    let Ok(directory) = attachment_directory(app) else {
        return;
    };
    let _ = attachments::discard(&directory, &references);
}

fn finalized_send_input(input: &Value, request_id: &str) -> Result<Value> {
    let references = attachments::references(input)?;
    if references.is_empty() {
        return Ok(input.clone());
    }
    // The longest chunk suffix is "-u3-8388607". Keep the device request
    // below the protocol limit after that suffix is added.
    ensure!(request_id.len() <= 45, "Image request ID is too large");
    let mut final_input = input.clone();
    final_input
        .as_object_mut()
        .context("Invalid send input")?
        .insert("uploadId".into(), Value::String(request_id.into()));
    Ok(final_input)
}

fn expired_upload(response: &Value) -> bool {
    response.get("ok").and_then(Value::as_bool) == Some(false)
        && response.get("outcomeUnknown").and_then(Value::as_bool) != Some(true)
        && response
            .get("error")
            .and_then(Value::as_str)
            .is_some_and(|message| message.contains("Image upload expired"))
}

async fn upload_staged_attachments(
    endpoint: &Endpoint,
    host: &EndpointAddr,
    request_id: &str,
    input: &Value,
    app: &AppHandle,
) -> Result<Value> {
    let references = attachments::references(input)?;
    if references.is_empty() {
        return Ok(input.clone());
    }
    let object = input.as_object().context("Invalid send input")?;
    let epoch = object.get("epoch").cloned().context("Invalid send input")?;
    let session_id = object
        .get("sessionId")
        .cloned()
        .context("Invalid send input")?;
    let turn = object.get("turn").cloned().context("Invalid send input")?;
    let directory = attachment_directory(app)?;
    for (index, reference) in references.iter().enumerate() {
        let bytes = attachments::read(&directory, reference)?;
        for (offset, chunk) in bytes.chunks(attachments::UPLOAD_CHUNK_BYTES).enumerate() {
            let offset = offset * attachments::UPLOAD_CHUNK_BYTES;
            let chunk_request_id = format!("{request_id}-u{index}-{offset}");
            ensure!(
                chunk_request_id.len() <= 56,
                "Image request ID is too large"
            );
            let response = exchange(
                endpoint,
                host,
                &Request::Command {
                    version: VERSION,
                    request_id: chunk_request_id,
                    action: "sessions.attachment.upload".into(),
                    input: json!({
                        "epoch": epoch.clone(),
                        "sessionId": session_id.clone(),
                        "turn": turn.clone(),
                        "uploadId": request_id,
                        "id": reference.id.clone(),
                        "name": reference.name.clone(),
                        "mimeType": reference.mime_type.clone(),
                        "size": reference.size,
                        "width": reference.width,
                        "height": reference.height,
                        "offset": offset,
                        "data": STANDARD.encode(chunk),
                    }),
                },
            )
            .await?;
            require_ok(&response)?;
        }
    }
    finalized_send_input(input, request_id)
}

#[derive(Serialize, Deserialize)]
struct Credentials {
    secret: String,
    host: Option<EndpointAddr>,
}

#[derive(Default)]
struct ClientState {
    endpoint: Option<Endpoint>,
    mutation_in_flight: bool,
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn load_private<T: serde::de::DeserializeOwned>(account: &str) -> Result<Option<T>> {
    match security_framework::passwords::get_generic_password(SERVICE, account) {
        Ok(bytes) => Ok(Some(
            serde_json::from_slice(&bytes).context("Invalid saved companion state")?,
        )),
        Err(error) if error.code() == -25300 => Ok(None),
        Err(error) => Err(error).context("Unlock this device to access its pairing identity"),
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn save_private<T: Serialize>(account: &str, value: &T) -> Result<()> {
    use security_framework::{
        access_control::{ProtectionMode, SecAccessControl},
        passwords::{set_generic_password_options, PasswordOptions},
    };
    let mut options = PasswordOptions::new_generic_password(SERVICE, account);
    options.set_access_synchronized(Some(false));
    options.set_access_control(SecAccessControl::create_with_protection(
        Some(ProtectionMode::AccessibleWhenUnlockedThisDeviceOnly),
        0,
    )?);
    set_generic_password_options(&serde_json::to_vec(value)?, options)?;
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
fn load_private<T: serde::de::DeserializeOwned>(_: &str) -> Result<Option<T>> {
    anyhow::bail!("Secure device storage is implemented for Apple platforms only")
}
#[cfg(not(any(target_os = "macos", target_os = "ios")))]
fn save_private<T: Serialize>(_: &str, _: &T) -> Result<()> {
    anyhow::bail!("Secure device storage is unavailable")
}

fn load_credentials() -> Result<Option<Credentials>> {
    load_private(ACCOUNT)
}
fn save_credentials(credentials: &Credentials) -> Result<()> {
    save_private(ACCOUNT, credentials)
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn delete_private(account: &str) -> Result<()> {
    if let Err(error) = security_framework::passwords::delete_generic_password(SERVICE, account) {
        if error.code() != -25300 {
            return Err(error.into());
        }
    }
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
fn delete_private(_: &str) -> Result<()> {
    anyhow::bail!("Secure device storage is unavailable")
}

fn status(credentials: Option<&Credentials>) -> Value {
    match credentials.and_then(|credentials| credentials.host.as_ref()) {
        Some(host) => json!({"paired":true,"hostId":host.id.to_string()}),
        None => json!({"paired":false}),
    }
}

async fn endpoint(state: &mut ClientState, credentials: &Credentials) -> Result<Endpoint> {
    if state.endpoint.is_none() {
        let key: SecretKey = credentials.secret.parse()?;
        state.endpoint = Some(client_endpoint(key).await?);
    }
    Ok(state
        .endpoint
        .as_ref()
        .context("Connection unavailable")?
        .clone())
}

#[tauri::command]
async fn companion_status() -> Result<Value, String> {
    load_credentials()
        .map(|credentials| status(credentials.as_ref()))
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn companion_pair(
    ticket: String,
    state: State<'_, Mutex<ClientState>>,
) -> Result<Value, String> {
    let result = async {
        let ticket = Ticket::decode(&ticket)?;
        let mut state = state.lock().await;
        ensure!(
            load_private::<PendingCommand>(PENDING_ACCOUNT)?.is_none(),
            "Review the pending command before pairing again"
        );
        let mut credentials = load_credentials()?.unwrap_or(Credentials {
            secret: random_hex(),
            host: None,
        });
        // Save identity before enrollment so a lost response can be retried by
        // this same device, rather than enrolling under a new key.
        save_credentials(&credentials)?;
        let endpoint = endpoint(&mut state, &credentials).await?;
        let response = exchange(
            &endpoint,
            &ticket.host,
            &Request::Pair {
                version: VERSION,
                invitation: ticket.invitation,
            },
        )
        .await?;
        require_ok(&response)?;
        credentials.host = Some(ticket.host);
        save_credentials(&credentials)?;
        Ok::<Value, anyhow::Error>(status(Some(&credentials)))
    }
    .await;
    result.map_err(|error| error.to_string())
}

#[tauri::command]
async fn companion_request(
    request_id: String,
    action: String,
    input: Value,
    state: State<'_, Mutex<ClientState>>,
    app: AppHandle,
) -> Result<Value, String> {
    let mutation = is_mutation(&action);
    let mut dispatch_started = false;
    let result = async {
        validate_command(&request_id, &action, &input)?;
        let mut client_state = state.lock().await;
        let credentials = load_credentials()?.context("Pair with the Mac first")?;
        let host = credentials
            .host
            .clone()
            .context("Pair with the Mac first")?;
        let endpoint = endpoint(&mut client_state, &credentials).await?;
        // A suspended request must not hold the state lock and prevent recovery.
        let mut is_retry = false;
        if mutation {
            let next = PendingCommand { version: 1, host_id: host.id.to_string(), request_id: request_id.clone(), action: action.clone(), input: input.clone() };
            next.validate(&host.id.to_string())?;
            if client_state.mutation_in_flight {
                return Ok(json!({"ok":false,"error":"A command is still in progress"}));
            }
            if let Some(saved) = load_private::<PendingCommand>(PENDING_ACCOUNT)? {
                is_retry = true;
                saved.validate(&host.id.to_string())?;
                if !saved.matches_retry(&next) {
                    return Ok(json!({"ok":false,"error":"Review the pending command before sending another"}));
                }
            }
            // Persist before any network dispatch; a killed app can recover the same ID.
            save_private(PENDING_ACCOUNT, &next)?;
            client_state.mutation_in_flight = true;
        }
        drop(client_state);
        let response = async {
            let outbound_input = if action == "sessions.send" {
                let final_input = finalized_send_input(&input, &request_id)?;
                if is_retry && input.get("attachments").is_some() {
                    // A lost final receipt is recoverable by the bridge's
                    // request receipt before we touch chunks or turn state.
                    dispatch_started = true;
                    let receipt = exchange(
                        &endpoint,
                        &host,
                        &Request::Command {
                            version: VERSION,
                            request_id: request_id.clone(),
                            action: action.clone(),
                            input: final_input.clone(),
                        },
                    ).await?;
                    if !expired_upload(&receipt) {
                        return Ok(receipt);
                    }
                    // The final send was definitely rejected before delivery;
                    // restage chunks below, then issue the exact same send.
                    dispatch_started = false;
                }
                upload_staged_attachments(&endpoint, &host, &request_id, &input, &app).await?
            } else { input.clone() };
            dispatch_started = true;
            exchange(
                &endpoint,
                &host,
                &Request::Command {
                    version: VERSION,
                    request_id: request_id.clone(),
                    action: action.clone(),
                    input: outbound_input,
                },
            )
            .await
        }
        .await;
        if mutation {
            let mut state = state.lock().await;
            state.mutation_in_flight = false;
            if let Ok(ref value) = response {
                if definitive_response(value, is_retry) {
                    delete_private(PENDING_ACCOUNT)?;
                    if action == "sessions.send" { clear_staged_attachments(&app, &input); }
                }
            } else if !dispatch_started {
                // Chunk staging cannot deliver a user message. A rejected or
                // interrupted preflight has no uncertain final send to retain.
                delete_private(PENDING_ACCOUNT)?;
                if action == "sessions.send" { clear_staged_attachments(&app, &input); }
            }
        }
        response
    }
    .await;
    match result {
        Ok(value) => Ok(value),
        Err(error) => Ok(json!({
            "ok": false,
            "error": error.to_string(),
            "outcomeUnknown": mutation && dispatch_started,
        })),
    }
}

#[tauri::command]
async fn companion_pending(
    state: State<'_, Mutex<ClientState>>,
    app: AppHandle,
) -> Result<Value, String> {
    let _state = state.lock().await;
    let result = (|| -> Result<Value> {
        let saved = load_private::<PendingCommand>(PENDING_ACCOUNT)?;
        let references = saved
            .as_ref()
            .filter(|pending| pending.action == "sessions.send")
            .and_then(|pending| attachments::references(&pending.input).ok())
            .unwrap_or_default();
        if let Ok(directory) = attachment_directory(&app) {
            attachments::clear_orphans(&directory, &references);
        }
        let Some(saved) = saved else {
            return Ok(json!([]));
        };
        let credentials = load_credentials()?.context("Saved command needs its paired Mac")?;
        let host = credentials
            .host
            .context("Saved command needs its paired Mac")?;
        saved.validate(&host.id.to_string())?;
        Ok(
            json!([{"requestId": saved.request_id, "action": saved.action, "input": saved.input, "error":"The previous command has not been confirmed. Review the conversation or retry the same command."}]),
        )
    })();
    result.map_err(|error| error.to_string())
}

#[tauri::command]
async fn companion_dismiss_pending(
    request_id: String,
    state: State<'_, Mutex<ClientState>>,
    app: AppHandle,
) -> Result<(), String> {
    let state = state.lock().await;
    let result = (|| -> Result<()> {
        ensure!(
            !state.mutation_in_flight,
            "Wait for the current command before clearing it"
        );
        if let Some(saved) = load_private::<PendingCommand>(PENDING_ACCOUNT)? {
            ensure!(
                saved.request_id == request_id,
                "The pending command changed; reopen the app to review it"
            );
            if saved.action == "sessions.send" {
                clear_staged_attachments(&app, &saved.input);
            }
            delete_private(PENDING_ACCOUNT)?;
        }
        Ok(())
    })();
    result.map_err(|error| error.to_string())
}

#[tauri::command]
fn companion_stage_attachment(
    image: attachments::StagedImage,
    app: AppHandle,
) -> Result<attachments::AttachmentReference, String> {
    let directory = attachment_directory(&app).map_err(|error| error.to_string())?;
    attachments::stage(&directory, image).map_err(|error| error.to_string())
}

#[tauri::command]
fn companion_discard_staged_attachments(
    references: Vec<attachments::AttachmentReference>,
    app: AppHandle,
) -> Result<(), String> {
    let directory = attachment_directory(&app).map_err(|error| error.to_string())?;
    attachments::discard(&directory, &references).map_err(|error| error.to_string())
}

#[tauri::command]
async fn companion_reconnect(state: State<'_, Mutex<ClientState>>) -> Result<(), String> {
    let result = async {
        let mut state = state.lock().await;
        let credentials = load_credentials()?.context("Pair with the Mac first")?;
        // Rebuild network sockets after iOS suspension, retaining the saved identity.
        // Interrupted mutations remain uncertain; the UI never replays them here.
        if let Some(previous) = state.endpoint.take() {
            let _ = tokio::time::timeout(std::time::Duration::from_secs(3), previous.close()).await;
        }
        endpoint(&mut state, &credentials).await?;
        Ok::<(), anyhow::Error>(())
    }
    .await;
    result.map_err(|error| error.to_string())
}

#[tauri::command]
async fn companion_forget(state: State<'_, Mutex<ClientState>>) -> Result<(), String> {
    let mut state = state.lock().await;
    if state.mutation_in_flight
        || load_private::<PendingCommand>(PENDING_ACCOUNT)
            .map_err(|e| e.to_string())?
            .is_some()
    {
        return Err("Review the pending command before forgetting this Mac".into());
    }
    delete_private(ACCOUNT).map_err(|error| error.to_string())?;
    if let Some(endpoint) = state.endpoint.take() {
        endpoint.close().await;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            #[cfg(target_os = "ios")]
            _app.handle().plugin(tauri_plugin_barcode_scanner::init())?;
            Ok(())
        })
        .manage(Mutex::new(ClientState::default()))
        .invoke_handler(tauri::generate_handler![
            companion_status,
            companion_pair,
            companion_request,
            companion_pending,
            companion_dismiss_pending,
            companion_stage_attachment,
            companion_discard_staged_attachments,
            companion_reconnect,
            companion_forget
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
