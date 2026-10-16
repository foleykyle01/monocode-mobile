//! Authenticated loopback transport. App windows own execution; callers never
//! receive arbitrary Tauri command access or direct database write access.
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

const APP_TURN_INACTIVE: &str = "MonoCode app access is inactive. Use /operator once in this thread to enable it, then call the CLI during an active agent turn. Retrying this request now will not enable access.";

#[derive(Clone)]
struct Grant {
    window: String,
    session: String,
    cwd: String,
    token: String,
}
struct Pending {
    window: String,
    reply: mpsc::Sender<Value>,
}
struct ActiveTurn {
    window: String,
    cwd: String,
    app_allowed: bool,
}
#[derive(Default)]
struct Inner {
    grants: HashMap<String, Grant>,
    app_grants: HashMap<String, Grant>,
    pending: HashMap<String, Pending>,
    workers: HashMap<String, String>,
    scratch: HashMap<String, PathBuf>,
    active: HashMap<String, ActiveTurn>,
    companion: Option<Grant>,
}
impl Inner {
    fn restart_ready(&self) -> Result<(), String> {
        if !self.active.is_empty() {
            return Err("Finish or stop active agent turns before installing this update".into());
        }
        if !self.pending.is_empty() {
            return Err(
                "An agent control request is still pending. Wait for it to finish before updating"
                    .into(),
            );
        }
        // workers records ownership/scratch registration, not turn liveness.
        // Every worker turn goes through control_authorize_turn and active;
        // renderer readiness still covers preparation and pending approvals.
        Ok(())
    }
    // Provider processes can stay alive between turns, so install the token
    // before their first spawn. request_grant still requires an opted-in turn.
    fn prepare_app_grant(&mut self, session: &str, window: &str, cwd: &str) -> bool {
        if self.workers.contains_key(session) || self.grants.contains_key(session) {
            return false;
        }
        let token = self
            .app_grants
            .get(session)
            .map(|grant| grant.token.clone())
            .unwrap_or_else(|| {
                format!(
                    "{}{}",
                    uuid::Uuid::new_v4().simple(),
                    uuid::Uuid::new_v4().simple()
                )
            });
        self.app_grants.insert(
            session.to_string(),
            Grant {
                window: window.to_string(),
                session: session.to_string(),
                cwd: cwd.to_string(),
                token,
            },
        );
        true
    }

    fn window_sessions(&self, label: &str) -> Vec<String> {
        let leads: Vec<String> = self
            .grants
            .values()
            .filter(|grant| grant.window == label)
            .map(|grant| grant.session.clone())
            .collect();
        let mut ids = leads.clone();
        ids.extend(
            self.app_grants
                .values()
                .filter(|grant| grant.window == label)
                .map(|grant| grant.session.clone()),
        );
        ids.extend(
            self.workers
                .iter()
                .filter(|(_, lead)| leads.contains(lead))
                .map(|(id, _)| id.clone()),
        );
        ids.extend(
            self.active
                .iter()
                .filter(|(_, turn)| turn.window == label)
                .map(|(id, _)| id.clone()),
        );
        ids.sort();
        ids.dedup();
        ids
    }
    fn close_window(&mut self, label: &str) -> (Vec<String>, bool) {
        let companion_owner_closed = self
            .companion
            .as_ref()
            .is_some_and(|grant| grant.window == label);
        if companion_owner_closed {
            self.companion = None;
        }
        let ids = self.window_sessions(label);
        self.grants.retain(|id, _| !ids.contains(id));
        self.app_grants.retain(|id, _| !ids.contains(id));
        self.workers.retain(|id, _| !ids.contains(id));
        self.scratch.retain(|id, _| !ids.contains(id));
        self.active.retain(|id, _| !ids.contains(id));
        self.pending.retain(|_, pending| {
            if pending.window != label {
                return true;
            }
            let _ = pending
                .reply
                .send(json!({"ok":false,"error":"MonoCode window closed"}));
            false
        });
        (ids, companion_owner_closed)
    }
}
pub struct ControlHost {
    endpoint: String,
    inner: Arc<Mutex<Inner>>,
}

impl ControlHost {
    /// A restart may only proceed when the native control service has no
    /// active turn or request still owned by a workspace.
    pub fn restart_ready(&self) -> Result<(), String> {
        self.inner
            .lock()
            .map_err(|_| "Could not inspect agent activity; retry the update".to_string())?
            .restart_ready()
    }
}

fn paths_overlap(a: &str, b: &str) -> bool {
    a == b || a.starts_with(&format!("{b}/")) || b.starts_with(&format!("{a}/"))
}

/** Windows paths compare case-insensitively; POSIX paths must retain case. */
fn comparison_path(path: &Path) -> String {
    let value = path.to_string_lossy().replace('\\', "/");
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    token: String,
    namespace: String,
    action: String,
    input: Value,
    request_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Event {
    id: String,
    namespace: String,
    session_id: String,
    request_id: String,
    action: String,
    input: Value,
}

fn request_grant(host: &Inner, namespace: &str, token: &str) -> Result<Grant, String> {
    let grant = match namespace {
        "control" => host.grants.values().find(|grant| grant.token == token),
        "app" => host.app_grants.values().find(|grant| grant.token == token),
        "companion" if cfg!(feature = "companion-spike") => {
            host.companion.as_ref().filter(|grant| grant.token == token)
        }
        _ => return Err("Unknown control namespace".into()),
    }
    .cloned()
    .ok_or("Connection revoked or unauthorized")?;
    if namespace == "app"
        && (host.grants.contains_key(&grant.session)
            || host.workers.contains_key(&grant.session)
            || !host
                .active
                .get(&grant.session)
                .is_some_and(|turn| turn.window == grant.window && turn.app_allowed))
    {
        return Err(APP_TURN_INACTIVE.into());
    }
    Ok(grant)
}

fn companion_action(action: &str) -> bool {
    matches!(
        action,
        "sessions.list"
            | "sessions.read"
            | "sessions.send"
            | "sessions.approve"
            | "sessions.answer"
            | "sessions.review.list"
            | "sessions.review.read"
            | "sessions.question.keepOpen"
            | "sessions.stop"
            | "sessions.configure"
            | "sessions.create"
            | "inbox.list"
            | "inbox.read"
            | "changes.list"
            | "changes.read"
            | "monos.read"
    )
}

fn companion_starts_or_resumes_work(action: &str) -> bool {
    matches!(
        action,
        "sessions.send"
            | "sessions.approve"
            | "sessions.answer"
            | "sessions.question.keepOpen"
            | "sessions.configure"
            | "sessions.create"
    )
}

pub fn init(app: &AppHandle) -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let endpoint = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .to_string();
    let inner = Arc::new(Mutex::new(Inner::default()));
    app.manage(ControlHost {
        endpoint,
        inner: inner.clone(),
    });
    let app = app.clone();
    std::thread::spawn(move || {
        // Limit concurrent readers, including unauthenticated sockets.
        let (tx, rx) = mpsc::sync_channel::<TcpStream>(32);
        let rx = Arc::new(Mutex::new(rx));
        for _ in 0..8 {
            let rx = rx.clone();
            let app = app.clone();
            let inner = inner.clone();
            std::thread::spawn(move || loop {
                let stream = match rx.lock() {
                    Ok(rx) => rx.recv(),
                    Err(_) => return,
                };
                let Ok(stream) = stream else { return };
                serve(stream, &app, &inner);
            });
        }
        for stream in listener.incoming().flatten() {
            let _ = tx.try_send(stream);
        }
    });
    Ok(())
}

fn receive_control_reply(receiver: &mpsc::Receiver<Value>, timeout: Duration) -> Value {
    receiver.recv_timeout(timeout).unwrap_or_else(|_| {
        // Losing the receipt does not cancel work already dispatched to the renderer.
        json!({"ok": false, "outcomeUnknown": true, "error": "Control request timed out. Retry with the same request ID."})
    })
}

fn serve(mut stream: TcpStream, app: &AppHandle, inner: &Arc<Mutex<Inner>>) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(3)));
    let result = (|| -> Result<Value, String> {
        let mut raw = String::new();
        BufReader::new(&mut stream)
            .take(262_145)
            .read_line(&mut raw)
            .map_err(|e| e.to_string())?;
        if raw.len() > 262_144 {
            return Err("Request exceeds 256 KiB".into());
        }
        let request: Request = serde_json::from_str(&raw).map_err(|_| "Invalid control request")?;
        if request.namespace == "companion" && !companion_action(&request.action) {
            return Err("Unsupported companion action".into());
        }
        if request.namespace == "companion"
            && companion_starts_or_resumes_work(&request.action)
            && app
                .try_state::<crate::safe_updater::SafeUpdater>()
                .is_some_and(|updater| crate::safe_updater::restart_locked(&updater))
        {
            return Err("MonoCode is restarting for an update; wait for it to reopen".into());
        }
        if !request.input.is_object()
            || request.request_id.is_empty()
            || request.request_id.len() > 128
        {
            return Err("Invalid input or request ID".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = mpsc::channel();
        let grant = {
            let mut host = inner.lock().map_err(|_| "Control service unavailable")?;
            let grant = request_grant(&host, &request.namespace, &request.token)?;
            if host.pending.len() >= 24 {
                return Err("Too many pending control requests".into());
            }
            host.pending.insert(
                id.clone(),
                Pending {
                    window: grant.window.clone(),
                    reply: tx,
                },
            );
            grant
        };
        let event = Event {
            id: id.clone(),
            namespace: request.namespace,
            session_id: grant.session,
            request_id: request.request_id,
            action: request.action,
            input: request.input,
        };
        let delivered = app.emit_to(grant.window.as_str(), "monocode-control-request", event);
        let result = if delivered.is_err() {
            Err("MonoCode executor is unavailable".into())
        } else {
            Ok(receive_control_reply(&rx, Duration::from_secs(35)))
        };
        if let Ok(mut host) = inner.lock() {
            host.pending.remove(&id);
        }
        result
    })();
    let response = result.unwrap_or_else(|error| {
        if error == APP_TURN_INACTIVE {
            json!({"ok": false, "error": error, "retryable": false})
        } else {
            json!({"ok": false, "error": error})
        }
    });
    let _ = writeln!(stream, "{response}");
}

fn require_companion_owner(inner: &Inner, window: &str) -> Result<(), String> {
    if !crate::window::is_workspace_window(window) {
        return Err("Open phone access from a MonoCode workspace window".into());
    }
    if inner
        .companion
        .as_ref()
        .is_some_and(|grant| grant.window != window)
    {
        return Err(
            "Phone access belongs to another MonoCode window. Open Connections in that window."
                .into(),
        );
    }
    Ok(())
}

#[tauri::command]
pub fn companion_enable(
    window: WebviewWindow,
    host: State<'_, ControlHost>,
) -> Result<String, String> {
    if !cfg!(feature = "companion-spike")
        || window.app_handle().config().identifier != "com.monocode.companion-spike"
    {
        return Err("Companion access requires the isolated development app".into());
    }
    // This capability belongs to a human's development client, never to an
    // agent turn. It is deliberately separate from app/control grants.
    let grant = Grant {
        window: window.label().into(),
        session: String::new(),
        cwd: String::new(),
        token: format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        ),
    };
    let directory = window
        .app_handle()
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let path = directory.join("companion-spike.json");
    let temporary = directory.join(format!(".companion-{}.tmp", uuid::Uuid::new_v4()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| -> Result<(), String> {
        let mut file = options.open(&temporary).map_err(|e| e.to_string())?;
        let descriptor = json!({
            "version": 1,
            "endpoint": host.endpoint,
            "token": grant.token,
            "application": "com.monocode.companion-spike"
        });
        writeln!(file, "{descriptor}").map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        let mut inner = host
            .inner
            .lock()
            .map_err(|_| "Control service unavailable")?;
        // Reopened workspaces get new labels; never steal another live owner's sessions.
        require_companion_owner(&inner, window.label())?;
        std::fs::rename(&temporary, &path).map_err(|e| e.to_string())?;
        inner.companion = Some(grant);
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn control_enable(
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    updater: State<'_, crate::safe_updater::SafeUpdater>,
    session_id: String,
    cwd: String,
) -> Result<String, String> {
    let _admission = crate::safe_updater::admit(&updater)?;
    let cwd = std::fs::canonicalize(crate::fs::expand_home(&cwd)).map_err(|e| e.to_string())?;
    if !cwd.is_dir() {
        return Err("Choose a project folder first".into());
    }
    let cwd = comparison_path(&cwd);
    let mut inner = host
        .inner
        .lock()
        .map_err(|_| "Control service unavailable")?;
    if let Some((id, _)) = inner
        .active
        .iter()
        .find(|(id, turn)| *id != &session_id && paths_overlap(&turn.cwd, &cwd))
    {
        return Err(format!(
            "Another session ({id}) is running in this checkout. Stop it before enabling orchestration."
        ));
    }
    if inner.grants.values().any(|g| {
        paths_overlap(&g.cwd, &cwd) && (g.session != session_id || g.window != window.label())
    }) {
        return Err("This checkout already has an orchestrator in another session".into());
    }
    // A lead may return to ordinary chat without respawning its provider.
    // Keep its app token installed but unusable until a later opted-in turn.
    inner.prepare_app_grant(&session_id, window.label(), &cwd);
    inner.grants.insert(
        session_id.clone(),
        Grant {
            window: window.label().into(),
            session: session_id.clone(),
            cwd,
            token: format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            ),
        },
    );
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(executable.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn control_disable(
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    session_id: String,
) -> Result<(), String> {
    let mut inner = host
        .inner
        .lock()
        .map_err(|_| "Control service unavailable")?;
    if inner
        .grants
        .get(&session_id)
        .is_some_and(|g| g.window == window.label())
    {
        inner.grants.remove(&session_id);
        inner.workers.retain(|_, parent| parent != &session_id);
        let workers = inner.workers.clone();
        inner.scratch.retain(|id, _| workers.contains_key(id));
    }
    Ok(())
}

#[tauri::command]
pub fn control_attach_worker(
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    updater: State<'_, crate::safe_updater::SafeUpdater>,
    lead_id: String,
    session_id: String,
) -> Result<String, String> {
    let _admission = crate::safe_updater::admit(&updater)?;
    let mut inner = host
        .inner
        .lock()
        .map_err(|_| "Control service unavailable")?;
    if inner
        .grants
        .get(&lead_id)
        .is_none_or(|grant| grant.window != window.label())
    {
        return Err("Lead connection is inactive".into());
    }
    let scratch = match inner.scratch.get(&session_id) {
        Some(path) if path.is_dir() => path.clone(),
        _ => create_worker_scratch()?,
    };
    inner.workers.insert(session_id.clone(), lead_id);
    inner.app_grants.remove(&session_id);
    inner.scratch.insert(session_id, scratch.clone());
    Ok(scratch.to_string_lossy().into_owned())
}

fn create_worker_scratch() -> Result<PathBuf, String> {
    let path = std::env::temp_dir().join(format!("monocode-worker-{}", uuid::Uuid::new_v4()));
    let builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    let builder = {
        use std::os::unix::fs::DirBuilderExt;
        let mut builder = builder;
        builder.mode(0o700);
        builder
    };
    builder.create(&path).map_err(|e| e.to_string())?;
    std::fs::canonicalize(path).map_err(|e| e.to_string())
}

fn configure_worker_scratch(cmd: &mut Command, path: &Path) {
    // Native temp-file helpers and shell mktemp use the same private scope
    // that is named in the worker's assignment prompt.
    cmd.env("TMPDIR", path).env("TMP", path).env("TEMP", path);
}

#[tauri::command]
pub fn control_authorize_turn(
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    updater: State<'_, crate::safe_updater::SafeUpdater>,
    session_id: String,
    cwd: String,
    app_access: bool,
) -> Result<(), String> {
    let _admission = crate::safe_updater::admit(&updater)?;
    let cwd = std::fs::canonicalize(crate::fs::expand_home(&cwd)).map_err(|e| e.to_string())?;
    let cwd = comparison_path(&cwd);
    let mut inner = host
        .inner
        .lock()
        .map_err(|_| "Control service unavailable")?;
    if let Some(lead) = inner
        .grants
        .values()
        .find(|grant| paths_overlap(&grant.cwd, &cwd))
    {
        if lead.window != window.label()
            || (lead.session != session_id && inner.workers.get(&session_id) != Some(&lead.session))
        {
            return Err("This checkout is controlled by an orchestrator. Stop that run before starting independent work.".into());
        }
    }
    let eligible = inner.prepare_app_grant(&session_id, window.label(), &cwd);
    let app_allowed = app_access && eligible;
    inner.active.insert(
        session_id,
        ActiveTurn {
            window: window.label().to_string(),
            cwd,
            app_allowed,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn control_turn_finished(host: State<'_, ControlHost>, session_id: String) {
    if let Ok(mut inner) = host.inner.lock() {
        inner.active.remove(&session_id);
    }
}

pub fn window_closed(app: &AppHandle, label: &str) {
    let host = app.state::<ControlHost>();
    let ids = {
        let Ok(inner) = host.inner.lock() else { return };
        inner.window_sessions(label)
    };
    for id in &ids {
        let _ = crate::harness::harness_kill(app.state(), id.clone());
    }
    let companion_owner_closed = host
        .inner
        .lock()
        .map(|mut inner| inner.close_window(label).1)
        .unwrap_or(false);
    if companion_owner_closed {
        // Surviving workspaces already mounted while this owner was alive.
        let _ = app.emit("monocode-companion-owner-needed", ());
    }
}

pub fn configure_child(app: &AppHandle, session_id: &str, cmd: &mut Command) {
    cmd.env_remove("MONOCODE_CONTROL_ENDPOINT")
        .env_remove("MONOCODE_CONTROL_TOKEN")
        .env_remove("MONOCODE_APP_ENDPOINT")
        .env_remove("MONOCODE_APP_TOKEN");
    let Some(host) = app.try_state::<ControlHost>() else {
        return;
    };
    if let Ok(inner) = host.inner.lock() {
        if let Some(grant) = inner.grants.get(session_id) {
            cmd.env("MONOCODE_CONTROL_ENDPOINT", &host.endpoint)
                .env("MONOCODE_CONTROL_TOKEN", &grant.token);
        }
        if let Some(grant) = inner.app_grants.get(session_id) {
            cmd.env("MONOCODE_APP_ENDPOINT", &host.endpoint)
                .env("MONOCODE_APP_TOKEN", &grant.token);
        }
        if let Some(scratch) = inner.scratch.get(session_id) {
            configure_worker_scratch(cmd, scratch);
        }
    };
}

#[tauri::command]
pub fn app_cli_path() -> Result<String, String> {
    std::env::current_exe()
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn control_reply(
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    id: String,
    response: Value,
) -> Result<(), String> {
    let mut inner = host
        .inner
        .lock()
        .map_err(|_| "Control service unavailable")?;
    if inner
        .pending
        .get(&id)
        .is_some_and(|p| p.window == window.label())
    {
        if let Some(pending) = inner.pending.remove(&id) {
            let _ = pending.reply.send(response);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn control_save(
    store: State<'_, crate::session_store::SessionStore>,
    lead_id: String,
    state: String,
) -> Result<(), String> {
    if state.len() > 8_000_000 {
        return Err("Orchestration history is too large".into());
    }
    let run: Value = serde_json::from_str(&state).map_err(|_| "Invalid run state")?;
    let conn = store.lock_conn()?;
    crate::session_store::save_orchestration(&conn, &lead_id, &run).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn control_load(
    store: State<'_, crate::session_store::SessionStore>,
    lead_id: String,
) -> Result<Option<String>, String> {
    use rusqlite::OptionalExtension;
    store
        .lock_conn()?
        .query_row(
            "SELECT state FROM orchestration_runs WHERE lead_id=?1",
            [lead_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())
}

fn resolve_scope(root: &Path, value: &str) -> Result<String, String> {
    let path = Path::new(value);
    if value.is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::Prefix(_)))
    {
        return Err("Write scopes must be project-relative paths without '..'".into());
    }
    let root = std::fs::canonicalize(root).map_err(|e| e.to_string())?;
    let mut existing = root.join(path);
    let mut missing = Vec::new();
    while !existing.exists() {
        missing.push(existing.file_name().ok_or("Invalid scope")?.to_os_string());
        if !existing.pop() {
            return Err("Invalid scope".into());
        }
    }
    existing = std::fs::canonicalize(existing).map_err(|e| e.to_string())?;
    if !existing.starts_with(&root) {
        return Err("Write scope points outside the project".into());
    }
    for part in missing.into_iter().rev() {
        existing.push(part);
    }
    Ok(comparison_path(&existing))
}

/// Resolve reported writes as well as scopes: aliases and symlinks must not
/// turn a private scratch directory into an exemption for another worker's files.
#[tauri::command]
pub fn control_write_path(path: String) -> Result<String, String> {
    let path = Path::new(&path);
    if !path.is_absolute() {
        return Err("Reported write paths must be absolute".into());
    }
    let mut existing = path;
    let mut missing = Vec::new();
    while !existing.exists() {
        // A dangling symlink cannot be treated as a new ordinary file.
        if std::fs::symlink_metadata(existing).is_ok() {
            return Err("Reported write path contains a dangling symlink".into());
        }
        missing.push(
            existing
                .file_name()
                .ok_or("Invalid write path")?
                .to_os_string(),
        );
        existing = existing.parent().ok_or("Invalid write path")?;
    }
    let mut resolved = std::fs::canonicalize(existing).map_err(|e| e.to_string())?;
    for part in missing.into_iter().rev() {
        resolved.push(part);
    }
    Ok(resolved.to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
pub fn control_scopes(cwd: String, files: Vec<String>) -> Result<Vec<String>, String> {
    if files.len() > 64 {
        return Err("At most 64 write scopes per task".into());
    }
    files
        .iter()
        .map(|file| {
            resolve_scope(&crate::fs::expand_home(&cwd), file)
                .map_err(|error| format!("Invalid write scope \"{file}\": {error}"))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restart_ignores_idle_worker_ownership_but_not_turns_or_requests() {
        let mut inner = Inner::default();
        inner.workers.insert("worker".into(), "lead".into());
        assert!(inner.restart_ready().is_ok());
        inner.active.insert(
            "worker".into(),
            ActiveTurn {
                window: "main".into(),
                cwd: "/fixture".into(),
                app_allowed: false,
            },
        );
        assert!(inner.restart_ready().unwrap_err().contains("agent turns"));
        inner.active.clear();
        let (reply, _) = mpsc::channel();
        inner.pending.insert(
            "request".into(),
            Pending {
                window: "main".into(),
                reply,
            },
        );
        assert!(inner
            .restart_ready()
            .unwrap_err()
            .contains("control request"));
        inner.pending.clear();
        assert!(inner.restart_ready().is_ok());
    }

    #[test]
    fn missing_control_receipts_preserve_uncertainty() {
        let (sender, receiver) = mpsc::channel();
        let response = receive_control_reply(&receiver, Duration::ZERO);
        assert_eq!(response["ok"], false);
        assert_eq!(response["outcomeUnknown"], true);
        // A timeout leaves the executor free to finish; it is not cancellation.
        sender
            .send(json!({"ok":true,"result":{"accepted":true}}))
            .unwrap();
        assert_eq!(receive_control_reply(&receiver, Duration::ZERO)["ok"], true);
        drop(sender);
        assert_eq!(
            receive_control_reply(&receiver, Duration::ZERO)["outcomeUnknown"],
            true
        );
    }

    #[test]
    fn companion_grant_is_separate_and_revoked_when_its_window_closes() {
        let mut inner = Inner {
            companion: Some(Grant {
                window: "main".into(),
                session: String::new(),
                cwd: String::new(),
                token: "device-token".into(),
            }),
            ..Default::default()
        };
        assert_eq!(
            request_grant(&inner, "companion", "device-token").is_ok(),
            cfg!(feature = "companion-spike")
        );
        assert!(request_grant(&inner, "companion", "wrong-token").is_err());
        assert!(request_grant(&inner, "app", "device-token").is_err());
        assert!(request_grant(&inner, "control", "device-token").is_err());
        assert!(!inner.close_window("other-window").1);
        assert!(inner.companion.is_some());
        assert!(inner.close_window("main").1);
        assert!(request_grant(&inner, "companion", "device-token").is_err());
        assert!(!inner.close_window("main").1);
    }

    #[test]
    fn companion_reopened_workspace_can_replace_closed_owner_without_stealing_live_owner() {
        let mut inner = Inner {
            companion: Some(Grant {
                window: "main".into(),
                session: String::new(),
                cwd: String::new(),
                token: "old-token".into(),
            }),
            ..Default::default()
        };
        assert!(require_companion_owner(&inner, "main").is_ok());
        assert!(require_companion_owner(&inner, "window-1").is_err());
        inner.close_window("main");
        assert!(request_grant(&inner, "companion", "old-token").is_err());
        assert!(require_companion_owner(&inner, "window-1").is_ok());
        inner.companion = Some(Grant {
            window: "window-1".into(),
            session: String::new(),
            cwd: String::new(),
            token: "new-token".into(),
        });
        assert_eq!(
            request_grant(&inner, "companion", "new-token").is_ok(),
            cfg!(feature = "companion-spike")
        );
        assert!(require_companion_owner(&inner, "window-2").is_err());
        for panel in [
            "mono-chat",
            "mono-chat-test",
            "quick-composer",
            "quick-composer-git",
        ] {
            assert!(require_companion_owner(&Inner::default(), panel).is_err());
        }
    }

    #[test]
    fn companion_action_allowlist_includes_companion_extensions() {
        for action in [
            "sessions.answer",
            "sessions.question.keepOpen",
            "sessions.review.list",
            "sessions.review.read",
        ] {
            assert!(companion_action(action));
        }
        assert!(!companion_action("sessions.review.undo"));
        assert!(!companion_action("sessions.review.keep"));
        assert!(companion_action("sessions.configure"));
        assert!(companion_action("sessions.create"));
        for action in [
            "inbox.list",
            "inbox.read",
            "changes.list",
            "changes.read",
            "monos.read",
        ] {
            assert!(companion_action(action), "{action}");
        }
        for action in [
            "inbox.start",
            "changes.stage",
            "changes.unstage",
            "changes.commit",
        ] {
            assert!(!companion_action(action), "{action}");
        }
        assert!(!companion_action("shell.exec"));
    }

    #[test]
    fn app_tokens_are_bound_to_active_turns_and_cannot_control_orchestration() {
        let mut inner = Inner::default();
        inner.app_grants.insert(
            "ordinary".into(),
            Grant {
                window: "main".into(),
                session: "ordinary".into(),
                cwd: "/repo".into(),
                token: "app-token".into(),
            },
        );
        assert!(matches!(
            request_grant(&inner, "app", "app-token"),
            Err(error) if error == APP_TURN_INACTIVE
        ));
        inner.active.insert(
            "ordinary".into(),
            ActiveTurn {
                window: "main".into(),
                cwd: "/repo".into(),
                app_allowed: true,
            },
        );
        assert!(request_grant(&inner, "app", "app-token").is_ok());
        assert!(request_grant(&inner, "control", "app-token").is_err());
        inner.active.get_mut("ordinary").unwrap().app_allowed = false;
        assert!(request_grant(&inner, "app", "app-token").is_err());
        inner.active.remove("ordinary");
        assert!(request_grant(&inner, "app", "app-token").is_err());
    }
    #[test]
    fn app_token_survives_normal_turns_but_only_works_when_opted_in() {
        let mut inner = Inner::default();
        assert!(inner.prepare_app_grant("ordinary", "main", "/repo"));
        let token = inner.app_grants["ordinary"].token.clone();
        inner.active.insert(
            "ordinary".into(),
            ActiveTurn {
                window: "main".into(),
                cwd: "/repo".into(),
                app_allowed: false,
            },
        );
        assert!(request_grant(&inner, "app", &token).is_err());
        assert!(inner.prepare_app_grant("ordinary", "main", "/repo"));
        assert_eq!(inner.app_grants["ordinary"].token, token);
        inner.grants.insert(
            "ordinary".into(),
            Grant {
                window: "main".into(),
                session: "ordinary".into(),
                cwd: "/repo".into(),
                token: "control-token".into(),
            },
        );
        assert!(!inner.prepare_app_grant("ordinary", "main", "/repo"));
        inner.active.get_mut("ordinary").unwrap().app_allowed = true;
        assert!(request_grant(&inner, "app", &token).is_err());
        inner.grants.remove("ordinary");
        assert!(inner.prepare_app_grant("ordinary", "main", "/repo"));
        assert_eq!(inner.app_grants["ordinary"].token, token);
        inner.active.get_mut("ordinary").unwrap().app_allowed = true;
        assert!(request_grant(&inner, "app", &token).is_ok());
        inner.active.remove("ordinary");
        assert!(request_grant(&inner, "app", &token).is_err());
    }
    #[cfg(not(windows))]
    #[test]
    fn comparison_keys_preserve_posix_case() {
        assert_eq!(comparison_path(Path::new("/tmp/Foo")), "/tmp/Foo");
        assert_ne!(
            comparison_path(Path::new("/tmp/Foo")),
            comparison_path(Path::new("/tmp/foo"))
        );
    }

    #[test]
    fn workers_get_distinct_private_scratch_and_matching_temp_environment() {
        let first = create_worker_scratch().unwrap();
        let second = create_worker_scratch().unwrap();
        assert_ne!(first, second);
        assert!(first.is_absolute());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&first).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
        let mut cmd = Command::new("unused");
        configure_worker_scratch(&mut cmd, &first);
        for key in ["TMPDIR", "TMP", "TEMP"] {
            assert!(cmd
                .get_envs()
                .any(|(name, value)| name == key && value == Some(first.as_os_str())));
        }
        let new_file = first.join("new/helper.py");
        assert_eq!(
            control_write_path(new_file.to_string_lossy().into_owned()).unwrap(),
            new_file.to_string_lossy().replace('\\', "/")
        );
        assert!(control_write_path("relative.py".into()).is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&second, first.join("escape")).unwrap();
            let resolved = control_write_path(
                first
                    .join("escape/helper.py")
                    .to_string_lossy()
                    .into_owned(),
            )
            .unwrap();
            assert_eq!(resolved, second.join("helper.py").to_string_lossy());
            std::os::unix::fs::symlink(first.join("missing"), first.join("dangling")).unwrap();
            assert!(control_write_path(
                first
                    .join("dangling/helper.py")
                    .to_string_lossy()
                    .into_owned()
            )
            .is_err());
        }
        std::fs::remove_dir_all(first).unwrap();
        std::fs::remove_dir_all(second).unwrap();
    }

    #[test]
    fn closing_a_window_releases_ordinary_turns_and_owned_orchestration() {
        let mut inner = Inner::default();
        for (id, window) in [
            ("ordinary", "closing"),
            ("lead", "closing"),
            ("other", "open"),
        ] {
            inner.active.insert(
                id.into(),
                ActiveTurn {
                    window: window.into(),
                    cwd: format!("/{id}"),
                    app_allowed: false,
                },
            );
        }
        for (id, window) in [("lead", "closing"), ("other", "open")] {
            inner.grants.insert(
                id.into(),
                Grant {
                    window: window.into(),
                    session: id.into(),
                    cwd: format!("/{id}"),
                    token: id.into(),
                },
            );
        }
        inner.workers.insert("worker".into(), "lead".into());
        inner.workers.insert("other-worker".into(), "other".into());
        let (reply, response) = mpsc::channel();
        inner.pending.insert(
            "pending".into(),
            Pending {
                window: "closing".into(),
                reply,
            },
        );
        let (reply, other_response) = mpsc::channel();
        inner.pending.insert(
            "other-pending".into(),
            Pending {
                window: "open".into(),
                reply,
            },
        );

        assert_eq!(
            inner.close_window("closing").0,
            ["lead", "ordinary", "worker"]
        );
        assert_eq!(inner.active.len(), 1);
        assert_eq!(inner.active["other"].window, "open");
        assert_eq!(inner.grants.len(), 1);
        assert!(inner.grants.contains_key("other"));
        assert_eq!(inner.workers.len(), 1);
        assert_eq!(inner.workers["other-worker"], "other");
        assert_eq!(response.try_recv().unwrap()["ok"], false);
        assert!(other_response.try_recv().is_err());
        assert!(inner.pending.contains_key("other-pending"));
        assert!(inner.close_window("closing").0.is_empty());
    }

    #[test]
    fn scopes_reject_escape_and_resolve_new_files() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&root).unwrap();
        assert!(resolve_scope(&root, "../escape").is_err());
        assert!(resolve_scope(&root, "/absolute").is_err());
        assert!(control_scopes(
            root.to_string_lossy().into_owned(),
            vec!["../escape".into()]
        )
        .unwrap_err()
        .contains("Invalid write scope \"../escape\""));
        assert!(resolve_scope(&root, "src/new.ts")
            .unwrap()
            .ends_with("/src/new.ts"));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(std::env::temp_dir(), root.join("outside")).unwrap();
            assert!(resolve_scope(&root, "outside/file").is_err());
        }
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn checkout_reservations_include_nested_folders() {
        assert!(paths_overlap("/repo", "/repo/src"));
        assert!(paths_overlap("/repo/src", "/repo"));
        assert!(!paths_overlap("/repo", "/repo2"));
    }
}
