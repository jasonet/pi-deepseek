// Main entry point for Pi-Deepseek Tauri 2 backend

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;

pub fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
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
