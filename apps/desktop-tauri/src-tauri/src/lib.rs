// Main entry point for Pi-Deepseek Tauri 2 backend.
//
// Beyond the original pi-detection helpers, this hosts the bridge to the Node
// sidecar (apps/desktop-tauri/sidecar) which runs the real Electron
// DesktopAppStore + pi runtime. The renderer's `window.piApp` shim calls the
// `pi_invoke` command; sidecar-emitted state/transcript events are forwarded to
// the webview on the `pi://event` channel.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager};
use tokio::sync::oneshot;

/// Managed state holding the live sidecar connection.
struct Sidecar {
    stdin: Mutex<std::process::ChildStdin>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<serde_json::Value, String>>>>>,
    next_id: AtomicU64,
}

/// Locate the sidecar entrypoint: bundled resource first, then a dev override
/// env var, then the in-repo dev build output.
fn resolve_server_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::path::BaseDirectory;
    if let Ok(p) = app
        .path()
        .resolve("sidecar/server.mjs", BaseDirectory::Resource)
    {
        if p.exists() {
            return Ok(p);
        }
    }
    if let Ok(dev) = std::env::var("PI_TAURI_SIDECAR") {
        let p = std::path::PathBuf::from(dev);
        if p.exists() {
            return Ok(p);
        }
    }
    let manifest = env!("CARGO_MANIFEST_DIR");
    let p = std::path::Path::new(manifest).join("../sidecar/dist/server.mjs");
    if p.exists() {
        return Ok(p);
    }
    Err(format!(
        "sidecar server.mjs not found (resources, PI_TAURI_SIDECAR, or {})",
        p.display()
    ))
}

/// Locate a usable `node` binary. A GUI-launched .app inherits only a minimal
/// PATH (/usr/bin:/bin:...), which usually lacks Homebrew/nvm/fnm, so `node`
/// won't be found via PATH alone. Try, in order: the self-contained Node binary
/// bundled inside the app (so the shipped build needs no system Node at all),
/// an explicit override env var, a PATH lookup, then well-known install
/// locations.
fn resolve_node_path(app: &tauri::AppHandle) -> String {
    use tauri::path::BaseDirectory;
    // Prefer the Node binary bundled at Resources/sidecar/node. Present only in
    // packaged builds; dev runs fall through to the host's node.
    if let Ok(bundled) = app.path().resolve("sidecar/node", BaseDirectory::Resource) {
        if bundled.exists() {
            return bundled.to_string_lossy().into_owned();
        }
    }
    if let Ok(explicit) = std::env::var("PI_TAURI_NODE") {
        if !explicit.is_empty() && std::path::Path::new(&explicit).exists() {
            return explicit;
        }
    }
    // `which node` honors the inherited PATH (works when launched from a shell).
    if let Ok(output) = Command::new("/usr/bin/which").arg("node").output() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path.is_empty() && std::path::Path::new(&path).exists() {
            return path;
        }
    }
    // Common absolute locations for GUI launches with a stripped PATH.
    let mut candidates: Vec<std::path::PathBuf> = vec![
        std::path::PathBuf::from("/opt/homebrew/bin/node"),
        std::path::PathBuf::from("/usr/local/bin/node"),
        std::path::PathBuf::from("/usr/bin/node"),
    ];
    // Newest nvm / fnm installs.
    if let Ok(home) = std::env::var("HOME") {
        for base in [
            format!("{home}/.nvm/versions/node"),
            format!("{home}/.local/state/fnm_multishells"),
            format!("{home}/Library/Application Support/fnm/node-versions"),
        ] {
            if let Ok(entries) = std::fs::read_dir(&base) {
                for entry in entries.flatten() {
                    candidates.push(entry.path().join("bin/node"));
                }
            }
        }
    }
    for candidate in candidates {
        if candidate.exists() {
            return candidate.to_string_lossy().into_owned();
        }
    }
    // Last resort: bare "node" and hope PATH resolves it.
    "node".to_string()
}

/// Spawn the Node sidecar and start the stdout reader thread that resolves
/// pending requests and forwards events to the webview.
fn start_sidecar(app: &tauri::AppHandle) -> Result<Sidecar, String> {
    let server = resolve_server_path(app)?;
    let node = resolve_node_path(app);

    // Ensure the spawned node (and any node-pty children it starts) can find the
    // node bin dir on PATH even under a minimal GUI environment.
    let mut child_path = std::env::var("PATH").unwrap_or_default();
    if let Some(bin_dir) = std::path::Path::new(&node).parent() {
        let bin = bin_dir.to_string_lossy();
        if !child_path.split(':').any(|p| p == bin) {
            child_path = if child_path.is_empty() {
                bin.to_string()
            } else {
                format!("{bin}:{child_path}")
            };
        }
    }

    let mut child = Command::new(&node)
        .arg(&server)
        .env("PATH", child_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("failed to spawn node sidecar: {e}"))?;

    let stdin = child.stdin.take().ok_or("sidecar missing stdin")?;
    let stdout = child.stdout.take().ok_or("sidecar missing stdout")?;

    let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<serde_json::Value, String>>>>> =
        Arc::new(Mutex::new(HashMap::new()));
    let pending_reader = pending.clone();
    let app_handle = app.clone();

    std::thread::spawn(move || {
        // Keep the child handle alive for the process lifetime.
        let _child = child;
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else {
                break;
            };
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let Ok(msg) = serde_json::from_str::<serde_json::Value>(trimmed) else {
                continue;
            };
            match msg.get("kind").and_then(|k| k.as_str()) {
                Some("response") => {
                    if let Some(id) = msg.get("id").and_then(|v| v.as_u64()) {
                        if let Some(tx) = pending_reader.lock().unwrap().remove(&id) {
                            let ok = msg.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
                            let res = if ok {
                                Ok(msg
                                    .get("result")
                                    .cloned()
                                    .unwrap_or(serde_json::Value::Null))
                            } else {
                                Err(msg
                                    .get("error")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("sidecar error")
                                    .to_string())
                            };
                            let _ = tx.send(res);
                        }
                    }
                }
                Some("event") => {
                    let _ = app_handle.emit("pi://event", msg);
                }
                _ => {}
            }
        }
    });

    Ok(Sidecar {
        stdin: Mutex::new(stdin),
        pending,
        next_id: AtomicU64::new(1),
    })
}

/// Renderer -> store bridge. Forwards a desktop IPC channel + args to the
/// sidecar and awaits the matching response.
#[tauri::command]
async fn pi_invoke(
    state: tauri::State<'_, Sidecar>,
    method: String,
    args: Vec<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let id = state.next_id.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = oneshot::channel();
    state.pending.lock().unwrap().insert(id, tx);

    let request = serde_json::json!({ "id": id, "method": method, "args": args });
    let line = format!("{}\n", request);
    {
        let mut stdin = state.stdin.lock().unwrap();
        stdin
            .write_all(line.as_bytes())
            .map_err(|e| format!("failed to write to sidecar: {e}"))?;
        stdin
            .flush()
            .map_err(|e| format!("failed to flush sidecar: {e}"))?;
    }

    rx.await
        .map_err(|_| "sidecar dropped the response".to_string())?
}

pub fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let handle = app.handle().clone();
            match start_sidecar(&handle) {
                Ok(sidecar) => {
                    app.manage(sidecar);
                }
                Err(error) => {
                    eprintln!("[pi-tauri] sidecar failed to start: {error}");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pi_invoke,
            check_pi_path,
            install_pi,
            get_pi_version,
            get_variant,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Pi-Deepseek");
}

/// Get pi binary path using various lookup methods.
#[tauri::command]
fn check_pi_path() -> Result<String, String> {
    // 1. which pi
    if let Ok(o) = std::process::Command::new("which").arg("pi").output() {
        let path = String::from_utf8_lossy(&o.stdout).trim().to_string();
        if !path.is_empty() {
            return Ok(path);
        }
    }
    // 2. npm root + pi
    if let Ok(o) = std::process::Command::new("npm").args(["root", "-g"]).output() {
        let root = String::from_utf8_lossy(&o.stdout).trim().to_string();
        let candidate = format!("{root}/@earendil-works/pi-coding-agent");
        if std::path::Path::new(&candidate).exists() {
            return Ok(format!("npm global: {candidate}"));
        }
    }
    // 3. node require path
    if let Ok(o) = std::process::Command::new("node")
        .args(["-e", "try{console.log(require.resolve('@earendil-works/pi-coding-agent'))}catch(e){}"])
        .output()
    {
        let path = String::from_utf8_lossy(&o.stdout).trim().to_string();
        if !path.is_empty() {
            return Ok(format!("node: {path}"));
        }
    }
    Err("pi not found".into())
}

/// Check if pi is available — tries PATH, npx, and node require.
fn try_pi_version() -> Option<String> {
    // 1. Try global `pi` command
    if let Ok(o) = Command::new("pi").arg("--version").output() {
        if o.status.success() {
            return Some(String::from_utf8_lossy(&o.stdout).trim().to_string());
        }
    }
    // 2. Try `npx pi --version`
    if let Ok(o) = Command::new("npx").args(["pi", "--version"]).output() {
        if o.status.success() {
            return Some(String::from_utf8_lossy(&o.stdout).trim().to_string());
        }
    }
    // 3. Try node require
    if let Ok(o) = Command::new("node")
        .args(["-e", "console.log(require('@earendil-works/pi-coding-agent/package.json').version)"])
        .output()
    {
        if o.status.success() {
            return Some(format!("node: {}", String::from_utf8_lossy(&o.stdout).trim()));
        }
    }
    None
}

/// Get pi CLI version (or "not-installed").
#[tauri::command]
fn get_pi_version() -> String {
    try_pi_version().unwrap_or_else(|| "not-installed".into())
}

/// Trigger pi installation via the official install script.
#[tauri::command]
async fn install_pi() -> Result<String, String> {
    let output = Command::new("sh")
        .arg("-c")
        .arg("curl -fsSL https://pi.dev/install.sh | sh")
        .output()
        .map_err(|e| format!("install failed: {}", e))?;

    if output.status.success() {
        Ok("pi installed successfully".into())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("install failed: {}", stderr))
    }
}

/// Return the current build variant: "with-pi" or "without-pi".
#[tauri::command]
fn get_variant() -> String {
    #[cfg(feature = "with-pi")]
    {
        "with-pi".into()
    }
    #[cfg(not(feature = "with-pi"))]
    {
        "without-pi".into()
    }
}
