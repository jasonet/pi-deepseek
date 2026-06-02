// Main entry point for Pi-Deepseek Tauri 2 backend

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;

pub fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            check_pi_installed,
            install_pi,
            get_pi_version,
            get_variant,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Pi-Deepseek");
}

/// Check if pi CLI is installed and return its version.
#[tauri::command]
fn check_pi_installed() -> Result<String, String> {
    let output = Command::new("pi")
        .arg("--version")
        .output()
        .map_err(|e| format!("pi not found: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err("pi command failed".into())
    }
}

/// Get pi version string (or "not-installed").
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
