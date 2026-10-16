//! The updater plugin verifies release signatures, but its webview commands
//! can install immediately. Keep the final install/restart native so a second
//! window or a phone request cannot race an active agent into a restart.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State, WebviewWindow};
use tauri_plugin_updater::{Update, UpdaterExt};

const READINESS_TIMEOUT: Duration = Duration::from_secs(4);

struct PreparedUpdate {
    update: Update,
    bytes: Vec<u8>,
}

struct Probe {
    windows: HashSet<String>,
    replies: tokio::sync::mpsc::UnboundedSender<(String, bool)>,
}

#[derive(Default)]
struct Inner {
    downloading: bool,
    restarting: bool,
    admissions: usize,
    prepared: Option<PreparedUpdate>,
    probes: HashMap<String, Probe>,
    // Keep proven-idle prompts parked after successful installation until exit.
    terminal_leases: Vec<crate::pty::RestartLease>,
}

/// One process-wide admission lock. It is deliberately held from before the
/// owner poll through installation and the restart request.
#[derive(Default)]
pub struct SafeUpdater {
    inner: Mutex<Inner>,
}

/// Holds native run/terminal admission open until its process is registered.
/// An update refuses to take the restart lock while one is in flight.
pub struct Admission<'a> {
    updater: &'a SafeUpdater,
}

impl Drop for Admission<'_> {
    fn drop(&mut self) {
        if let Ok(mut inner) = self.updater.inner.lock() {
            inner.admissions = inner.admissions.saturating_sub(1);
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub body: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    pub available: bool,
    pub version: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessReply {
    id: String,
    safe: bool,
}

pub fn restart_locked(updater: &SafeUpdater) -> bool {
    updater
        .inner
        .lock()
        .map(|inner| inner.restarting)
        .unwrap_or(true)
}

pub fn admit(updater: &SafeUpdater) -> Result<Admission<'_>, String> {
    let mut inner = updater
        .inner
        .lock()
        .map_err(|_| "Update service unavailable")?;
    if inner.restarting {
        return Err("MonoCode is restarting for an update; wait for it to reopen".into());
    }
    inner.admissions += 1;
    Ok(Admission { updater })
}

fn release_restart_lock(app: &AppHandle, updater: &SafeUpdater) {
    clear_restart_lock(updater);
    let _ = app.emit("monocode-update-restart-cancelled", ());
}

fn clear_restart_lock(updater: &SafeUpdater) {
    if let Ok(mut inner) = updater.inner.lock() {
        inner.restarting = false;
    }
}

fn begin_restart(updater: &SafeUpdater) -> Result<PreparedUpdate, String> {
    let mut inner = updater
        .inner
        .lock()
        .map_err(|_| "Update service unavailable")?;
    if inner.restarting || inner.downloading {
        return Err("An update operation is already in progress".into());
    }
    if inner.admissions != 0 {
        return Err("Agent or terminal input is being prepared. Wait for it to finish, then retry the update".into());
    }
    let prepared = inner
        .prepared
        .take()
        .ok_or("Download the update before restarting")?;
    inner.restarting = true;
    Ok(prepared)
}

fn validate_readiness(
    expected: &HashSet<String>,
    replies: impl IntoIterator<Item = (String, bool)>,
) -> Result<(), String> {
    let mut waiting = expected.clone();
    for (window, safe) in replies {
        if !waiting.remove(&window) {
            continue;
        }
        if !safe {
            return Err("Finish or stop active work before installing this update".into());
        }
    }
    if waiting.is_empty() {
        Ok(())
    } else {
        Err("A MonoCode workspace did not confirm it is safe to restart".into())
    }
}

#[tauri::command]
pub async fn safe_update_check(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let update = app
        .updater()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;
    Ok(update.map(|update| UpdateInfo {
        version: update.version,
        body: update.body,
    }))
}

/// Download and signature-check while the user keeps working. The verified
/// bytes remain only in this process; restart must still pass the owner gate.
#[tauri::command]
pub async fn safe_update_download(
    app: AppHandle,
    updater: State<'_, SafeUpdater>,
) -> Result<DownloadResult, String> {
    {
        let mut inner = updater
            .inner
            .lock()
            .map_err(|_| "Update service unavailable")?;
        if inner.restarting || inner.admissions != 0 {
            return Err("MonoCode is preparing to restart for an update".into());
        }
        if inner.downloading {
            return Err("An update download is already in progress".into());
        }
        inner.downloading = true;
    }

    let result = async {
        let update = app
            .updater()
            .map_err(|error| error.to_string())?
            .check()
            .await
            .map_err(|error| error.to_string())?;
        let Some(update) = update else {
            return Ok(DownloadResult {
                available: false,
                version: None,
            });
        };
        let version = update.version.clone();
        let event_app = app.clone();
        let bytes = update
            .download(
                move |chunk, total| {
                    let _ = event_app.emit(
                        "monocode-update-download-progress",
                        serde_json::json!({ "chunk": chunk, "total": total }),
                    );
                },
                || {},
            )
            .await
            .map_err(|error| error.to_string())?;
        let mut inner = updater
            .inner
            .lock()
            .map_err(|_| "Update service unavailable")?;
        inner.prepared = Some(PreparedUpdate { update, bytes });
        Ok(DownloadResult {
            available: true,
            version: Some(version),
        })
    }
    .await;

    if let Ok(mut inner) = updater.inner.lock() {
        inner.downloading = false;
    }
    result
}

async fn ready_windows(app: &AppHandle, updater: &SafeUpdater) -> Result<(), String> {
    let windows = crate::window::workspace_windows(app);
    if windows.is_empty() {
        return Err("Open a MonoCode workspace before restarting for an update".into());
    }
    let labels: HashSet<String> = windows
        .iter()
        .map(|window| window.label().to_string())
        .collect();
    let id = uuid::Uuid::new_v4().to_string();
    let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
    {
        let mut inner = updater
            .inner
            .lock()
            .map_err(|_| "Update service unavailable")?;
        inner.probes.insert(
            id.clone(),
            Probe {
                windows: labels.clone(),
                replies: sender,
            },
        );
    }

    for window in &windows {
        if window
            .emit(
                "monocode-update-restart-check",
                serde_json::json!({ "id": id }),
            )
            .is_err()
        {
            if let Ok(mut inner) = updater.inner.lock() {
                inner.probes.remove(&id);
            }
            return Err("A MonoCode workspace is not ready to check for a safe restart".into());
        }
    }

    let ready = async {
        let mut waiting = labels.clone();
        let mut replies = Vec::with_capacity(waiting.len());
        while !waiting.is_empty() {
            let Some((window, safe)) = tokio::time::timeout(READINESS_TIMEOUT, receiver.recv())
                .await
                .map_err(|_| "A MonoCode workspace did not confirm it is safe to restart")?
            else {
                return Err("A MonoCode workspace did not confirm it is safe to restart".into());
            };
            if waiting.remove(&window) {
                replies.push((window, safe));
            }
        }
        validate_readiness(&labels, replies)
    }
    .await;
    if let Ok(mut inner) = updater.inner.lock() {
        inner.probes.remove(&id);
    }
    ready?;
    let current: HashSet<String> = crate::window::workspace_windows(app)
        .iter()
        .map(|window| window.label().to_string())
        .collect();
    if current != labels {
        return Err("MonoCode windows changed while the update was being prepared".into());
    }
    Ok(())
}

#[tauri::command]
pub fn safe_update_restart_ready(
    window: WebviewWindow,
    updater: State<'_, SafeUpdater>,
    reply: ReadinessReply,
) -> Result<(), String> {
    let sender = updater
        .inner
        .lock()
        .map_err(|_| "Update service unavailable")?
        .probes
        .get(&reply.id)
        .filter(|probe| probe.windows.contains(window.label()))
        .map(|probe| probe.replies.clone());
    if let Some(sender) = sender {
        let _ = sender.send((window.label().to_string(), reply.safe));
    }
    Ok(())
}

/// The only command allowed to install a companion update. It gates all new
/// native turn admission before asking every existing workspace to flush and
/// prove it has no work, then installs the verified bytes and requests restart.
#[tauri::command]
pub async fn safe_update_install_and_restart(
    app: AppHandle,
    window: WebviewWindow,
    updater: State<'_, SafeUpdater>,
    control: State<'_, crate::control::ControlHost>,
    pty: State<'_, crate::pty::PtyHost>,
) -> Result<(), String> {
    if !crate::window::is_workspace_window(window.label()) {
        return Err("Install the update from a MonoCode workspace".into());
    }
    let prepared = begin_restart(&updater)?;

    let mut terminal_leases = Vec::new();
    let result = async {
        control.restart_ready()?;
        if !crate::worktree_lifecycle::restart_safe() {
            return Err("Project preparation is still active. Wait for it to finish before updating".into());
        }
        terminal_leases = pty.prepare_restart()?;
        ready_windows(&app, &updater).await?;
        // Recheck after the renderer replies: the admission lock stops new
        // turns, and this catches already-authorized helpers/control work.
        control.restart_ready()?;
        if !crate::worktree_lifecycle::restart_safe() {
            return Err("Project preparation changed while the update was being prepared; retry when it finishes".into());
        }
        Ok(())
    }
    .await;

    if let Err(error) = result {
        drop(terminal_leases);
        if let Ok(mut inner) = updater.inner.lock() {
            inner.prepared = Some(prepared);
        }
        release_restart_lock(&app, &updater);
        return Err(error);
    }

    // Signature verification happened during download. Installation itself
    // can block on disk I/O, so never hold the webview command thread while
    // workspace renderers are receiving the readiness event.
    let install_result = tauri::async_runtime::spawn_blocking(move || {
        let result = prepared
            .update
            .install(&prepared.bytes)
            .map_err(|error| error.to_string());
        (prepared, result)
    })
    .await;
    let (prepared, install) = match install_result {
        Ok(result) => result,
        Err(error) => {
            drop(terminal_leases);
            release_restart_lock(&app, &updater);
            return Err(error.to_string());
        }
    };

    if let Err(error) = install {
        drop(terminal_leases);
        if let Ok(mut inner) = updater.inner.lock() {
            inner.prepared = Some(prepared);
        }
        release_restart_lock(&app, &updater);
        return Err(error);
    }

    // Keep the admission lock set until this process exits so no turn starts
    // in the narrow gap before the relaunch.
    if let Ok(mut inner) = updater.inner.lock() {
        inner.terminal_leases = terminal_leases;
    }
    app.request_restart();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn admission_holds_restart_from_starting_until_registration_finishes() {
        let updater = SafeUpdater::default();
        let admission = admit(&updater).unwrap();
        assert_eq!(updater.inner.lock().unwrap().admissions, 1);
        assert_eq!(
            begin_restart(&updater).err().as_deref(),
            Some("Agent or terminal input is being prepared. Wait for it to finish, then retry the update")
        );
        drop(admission);
        assert_eq!(updater.inner.lock().unwrap().admissions, 0);
        assert_eq!(
            begin_restart(&updater).err().as_deref(),
            Some("Download the update before restarting")
        );
    }

    #[test]
    fn restart_lock_refuses_new_admission_until_failure_releases_it() {
        let updater = SafeUpdater::default();
        updater.inner.lock().unwrap().restarting = true;
        assert!(admit(&updater).is_err());
        clear_restart_lock(&updater);
        assert!(admit(&updater).is_ok());
    }

    #[test]
    fn terminal_input_is_refused_before_lookup_during_restart_and_unblocked_on_cancel() {
        let updater = SafeUpdater::default();
        let terminal = crate::pty::PtyHost::new();
        updater.inner.lock().unwrap().restarting = true;
        assert!(terminal
            .write_terminal(&updater, "term", "run\n")
            .unwrap_err()
            .contains("restarting"));
        clear_restart_lock(&updater);
        assert_eq!(
            terminal
                .write_terminal(&updater, "term", "run\n")
                .unwrap_err(),
            "Terminal is not running"
        );
        assert_eq!(updater.inner.lock().unwrap().admissions, 0);
    }

    #[test]
    fn readiness_requires_one_safe_reply_from_every_workspace() {
        let expected = HashSet::from(["left".into(), "right".into()]);
        assert!(
            validate_readiness(&expected, [("left".into(), true), ("right".into(), true)],).is_ok()
        );
        assert!(validate_readiness(&expected, [("left".into(), true)]).is_err());
        assert!(
            validate_readiness(&expected, [("left".into(), false), ("right".into(), true)],)
                .is_err()
        );
    }

    #[test]
    fn failed_install_path_can_release_the_restart_lock() {
        let updater = SafeUpdater::default();
        updater.inner.lock().unwrap().restarting = true;
        clear_restart_lock(&updater);
        assert!(!restart_locked(&updater));
    }

    #[test]
    fn restart_lock_fails_closed_when_the_mutex_is_poisoned() {
        let updater = SafeUpdater::default();
        let _ = std::panic::catch_unwind(|| {
            let _guard = updater.inner.lock().unwrap();
            panic!("poison");
        });
        assert!(restart_locked(&updater));
    }
}
