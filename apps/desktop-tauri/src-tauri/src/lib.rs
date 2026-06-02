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

/// Get pi CLI version string.
#[tauri::command]
fn check_pi_path() -> Result<String, String> {
    let output = std::process::Command::new("which")
        .arg("pi")
        .output()
        .map_err(|e| format!("which failed: {}", e))?;

    if output.status.success() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if path.is_empty() {
            Err("pi not found on PATH".into())
        } else {
            Ok(path)
        }
    } else {
        Err("pi not found on PATH".into())
    }
}

/// Get pi CLI version (or "not-installed").
#[tauri::command]
fn get_pi_version() -> String {
    Command::new("pi")
        .arg("--version")
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        })
        .unwrap_or_else(|| "not-installed".into())
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
