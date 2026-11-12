use serde_json::{json, Value};
use std::{collections::HashMap, io::{BufRead, BufReader, Write}, process::{Child, ChildStdin, Command, Stdio}, sync::{Arc, Mutex, atomic::{AtomicBool, AtomicU64, Ordering}}, time::Duration};
use tauri::{Emitter, Manager, Runtime, WebviewWindow, plugin::{Builder, TauriPlugin}};
use tokio::sync::oneshot;

pub fn install_menu<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
    let application = SubmenuBuilder::new(app, "Taosi Pake")
        .item(&PredefinedMenuItem::about(app, Some("About Taosi Pake"), None)?)
        .item(&MenuItemBuilder::with_id("taosi:open-settings", "Settings…").accelerator("CmdOrCtrl+,").build(app)?)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator().item(&PredefinedMenuItem::quit(app, None)?).build()?;
    let mut file = SubmenuBuilder::new(app, "File");
    for (id, title, key) in [("open-new-thread", "New Thread", "N"), ("open-folder", "Open Folder…", "O"), ("close-active-session", "Close Conversation", "W"), ("open-connect-phone", "Connect Phone", "M")] {
        file = file.item(&MenuItemBuilder::with_id(format!("taosi:{id}"), title).accelerator(format!("CmdOrCtrl+{key}")).build(app)?);
    }
    let edit = SubmenuBuilder::new(app, "Edit").item(&PredefinedMenuItem::undo(app, None)?).item(&PredefinedMenuItem::redo(app, None)?)
        .separator().item(&PredefinedMenuItem::cut(app, None)?).item(&PredefinedMenuItem::copy(app, None)?).item(&PredefinedMenuItem::paste(app, None)?).item(&PredefinedMenuItem::select_all(app, None)?).build()?;
    let view = SubmenuBuilder::new(app, "View").item(&PredefinedMenuItem::fullscreen(app, None)?).build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .item(&MenuItemBuilder::with_id("taosi-native:minimize", "Minimize").build(app)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .item(&MenuItemBuilder::with_id("taosi-native:show", "Bring All to Front").build(app)?).build()?;
    let menu = MenuBuilder::new(app).item(&application).item(&file.build()?).item(&edit).item(&view).item(&window).build()?;
    app.set_menu(menu)?;
    Ok(())
}

type Reply = Result<Value, String>;
type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Reply>>>>;
struct Host {
    input: Arc<Mutex<Option<ChildStdin>>>,
    child: Mutex<Option<Child>>,
    pending: Pending,
    next: AtomicU64,
    closing: AtomicBool,
}

fn trusted<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    window.url().map(|url| url.scheme() == "tauri" && url.host_str() == Some("localhost")).unwrap_or(false)
}
fn write(input: &Arc<Mutex<Option<ChildStdin>>>, value: &Value) -> Result<(), String> {
    let mut guard = input.lock().map_err(|_| "Sidecar input lock failed")?;
    let stdin = guard.as_mut().ok_or("Sidecar is stopped")?;
    writeln!(stdin, "{value}").and_then(|_| stdin.flush()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn invoke<R: Runtime>(window: WebviewWindow<R>, host: tauri::State<'_, Host>, method: String, args: Vec<Value>) -> Reply {
    if !trusted(&window) { return Err("Backend access requires the local Taosi document".into()); }
    let id = host.next.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel();
    host.pending.lock().unwrap().insert(id, tx);
    if let Err(error) = write(&host.input, &json!({"id":id,"method":method,"args":args})) {
        host.pending.lock().unwrap().remove(&id);
        return Err(error);
    }
    let result = tokio::time::timeout(Duration::from_secs(600), rx).await;
    host.pending.lock().unwrap().remove(&id);
    match result {
        Ok(Ok(value)) => value,
        Ok(Err(_)) => Err("Taosi sidecar disconnected".into()),
        Err(_) => Err("Taosi operation timed out".into()),
    }
}

#[tauri::command]
fn host_response<R: Runtime>(window: WebviewWindow<R>, host: tauri::State<'_, Host>, response: Value) -> Result<(), String> {
    if !trusted(&window) { return Err("Local document required".into()); }
    write(&host.input, &json!({"kind":"host-response", "id":response["id"], "ok":response["ok"], "result":response["result"], "error":response["error"]}))
}

#[tauri::command]
async fn prompt<R: Runtime>(window: WebviewWindow<R>, message: String) -> Result<Option<String>, String> {
    if !trusted(&window) { return Err("Local document required".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let output = Command::new("/usr/bin/osascript").args(["-e", "on run argv\ntry\nreturn text returned of (display dialog (item 1 of argv) default answer \"\" with title \"Taosi Pake login\")\non error number -128\nreturn \"__TAOSI_CANCELLED__\"\nend try\nend run", "--", &message]).output().map_err(|e| e.to_string())?;
        if !output.status.success() { return Err("Could not open login dialog".into()); }
        let value = String::from_utf8_lossy(&output.stdout).trim_end_matches('\n').to_string();
        Ok(if value == "__TAOSI_CANCELLED__" { None } else { Some(value) })
    }).await.map_err(|e| e.to_string())?
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("taosi")
        .invoke_handler(tauri::generate_handler![invoke, host_response, prompt])
        .setup(|app, _| {
            app.on_menu_event(|app, event| {
                if event.id().as_ref() == "taosi-native:minimize" { if let Some(window) = app.get_webview_window("pake") { let _ = window.minimize(); } }
                if event.id().as_ref() == "taosi-native:show" { if let Some(window) = app.get_webview_window("pake") { let _ = window.show(); let _ = window.set_focus(); } }
                if let Some(command) = event.id().as_ref().strip_prefix("taosi:") {
                    if let Some(window) = app.get_webview_window("pake").filter(trusted) { let _ = window.emit("taosi://command", command); }
                }
            });
            let resources = app.path().resource_dir()?;
            let data = std::env::var_os("PI_APP_USER_DATA_DIR").map(std::path::PathBuf::from).unwrap_or(app.path().app_data_dir()?);
            std::fs::create_dir_all(&data)?;
            let agent = std::env::var_os("PI_CODING_AGENT_DIR").map(std::path::PathBuf::from).unwrap_or(data.join("agent"));
            std::fs::create_dir_all(&agent)?;
            if let Some(home) = std::env::var_os("HOME").filter(|_| std::env::var_os("PI_CODING_AGENT_DIR").is_none()) {
                for name in ["auth.json", "models.json", "settings.json"] {
                    let source = std::path::Path::new(&home).join(".pi/agent").join(name);
                    let destination = agent.join(name);
                    if source.is_file() && !destination.exists() {
                        std::fs::copy(source, &destination)?;
                        use std::os::unix::fs::PermissionsExt;
                        std::fs::set_permissions(destination, std::fs::Permissions::from_mode(0o600))?;
                    }
                }
            }
            let runtime = resources.join("sidecar");
            let log = std::fs::OpenOptions::new().create(true).append(true).open(data.join("sidecar.log"))?;
            let mut child = Command::new(runtime.join("node")).arg(runtime.join("server.mjs"))
                .env("PI_SIDECAR_HOST", "pake").env("PI_APP_USER_DATA_DIR", &data)
                .env("PI_CODING_AGENT_DIR", &agent)
                .env("IM_WEBHOOK_PORT", std::env::var("IM_WEBHOOK_PORT").unwrap_or("18789".into()))
                .env("PI_APP_VERSION", app.package_info().version.to_string())
                .env("PI_APP_RESOURCES_DIR", &resources)
                .env("PI_FX_BUNDLED_ROOT", runtime.join("fx"))
                .env("PI_BUNDLED_EXTENSIONS_DIR", resources.join("extensions"))
                .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::from(log)).spawn()?;
            let input = Arc::new(Mutex::new(child.stdin.take()));
            let stdout = child.stdout.take().ok_or("Missing sidecar stdout")?;
            let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
            app.manage(Host { input: input.clone(), child: Mutex::new(Some(child)), pending: pending.clone(), next: AtomicU64::new(1), closing: AtomicBool::new(false) });
            let handle = app.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stdout).lines() {
                    let Ok(line) = line else { break };
                    let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
                    match value["kind"].as_str() {
                        Some("response") => {
                            if let Some(tx) = value["id"].as_u64().and_then(|id| pending.lock().unwrap().remove(&id)) {
                                let result = if value["ok"] == true { Ok(value["result"].clone()) } else { Err(value["error"].as_str().unwrap_or("Sidecar error").to_string()) };
                                let _ = tx.send(result);
                            }
                        }
                        Some("event") | Some("host") => {
                            if let Some(window) = handle.get_webview_window("pake").filter(trusted) {
                                let event = if value["kind"] == "host" { "taosi://host" } else { "taosi://event" };
                                let _ = window.emit(event, &value);
                            }
                        }
                        _ => {}
                    }
                }
                for (_, tx) in pending.lock().unwrap().drain() { let _ = tx.send(Err("Taosi backend exited; restart the application".into())); }
            });
            Ok(())
        })
        .on_window_ready(|window| {
            let label = window.label().to_string();
            let app = window.app_handle().clone();
            window.on_window_event(move |_| {
                if let (Some(host), Some(window)) = (app.try_state::<Host>(), app.get_webview_window(&label)) {
                    let _ = write(&host.input, &json!({"kind":"window", "focused":window.is_focused().unwrap_or(false), "visible":window.is_visible().unwrap_or(false), "minimized":window.is_minimized().unwrap_or(false)}));
                }
            });
        })
        .on_event(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if let Some(host) = app.try_state::<Host>() {
                    if host.closing.swap(true, Ordering::SeqCst) { return; }
                    api.prevent_exit();
                    host.input.lock().unwrap().take();
                    let child = host.child.lock().unwrap().take();
                    let handle = app.clone();
                    std::thread::spawn(move || {
                        if let Some(mut child) = child {
                            let mut exited = false;
                            for _ in 0..50 {
                                if child.try_wait().ok().flatten().is_some() { exited = true; break; }
                                std::thread::sleep(Duration::from_millis(100));
                            }
                            if !exited { let _ = child.kill(); }
                            let _ = child.wait();
                        }
                        handle.exit(0);
                    });
                }
            }
        })
        .build()
}
