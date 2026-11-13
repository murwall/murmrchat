const KEYCHAIN_SERVICE: &str = "com.matterix.desktop";

fn entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, key).map_err(|e| e.to_string())
}

/// Read a secret (e.g. the session tokens) from the OS keychain.
#[tauri::command]
fn secret_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Store a secret in the OS keychain.
#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
    entry(&key)?.set_password(&value).map_err(|e| e.to_string())
}

/// Remove a secret from the OS keychain.
#[tauri::command]
fn secret_delete(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Write a diagnostic line from the web UI to stderr (CSP violations, uncaught errors).
/// The packaged app has no visible devtools console, so this is how problems surface.
#[tauri::command]
fn frontend_log(level: String, message: String) {
    let msg: String = message.chars().take(2000).collect();
    eprintln!("[matterix:{level}] {msg}");
}

/// Opt out of App Nap. With the window closed to the Dock, macOS would otherwise throttle the app's
/// timers and delay sync/notifications by minutes. The system can still sleep normally.
#[cfg(target_os = "macos")]
fn disable_app_nap() {
    use objc2_foundation::{NSActivityOptions, NSProcessInfo, NSString};
    let reason = NSString::from_str("Receiving chat messages and notifications in the background");
    let token = NSProcessInfo::processInfo()
        .beginActivityWithOptions_reason(NSActivityOptions::UserInitiatedAllowingIdleSystemSleep, &reason);
    // Keep the activity for the app's whole lifetime.
    std::mem::forget(token);
}

/// Bring the main window back (Dock icon click, or reopen).
fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "macos")]
    disable_app_nap();

    tauri::Builder::default()
        // Closing the window (red button / Cmd+W) only hides it, like Mattermost and other Mac chat
        // apps: Matterix keeps syncing and notifying in the background. Cmd+Q really quits.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![secret_get, secret_set, secret_delete, frontend_log])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Clicking the Dock icon while the window is hidden brings it back.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                show_main_window(app);
            }
            let _ = (app, event);
        });
}
