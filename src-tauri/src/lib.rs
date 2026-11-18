const KEYCHAIN_SERVICE: &str = "se.murwall.murmrchat";

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

/// Save a newly generated recovery key as a text file in the user's Downloads folder (never
/// overwriting an existing file) and return its path. The file is readable by the user only.
#[tauri::command]
fn save_recovery_key(app: tauri::AppHandle, contents: String) -> Result<String, String> {
    use std::io::Write;
    use tauri::Manager;
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    for n in 0..100 {
        let name = if n == 0 { "murmrchat-recovery-key.txt".to_string() } else { format!("murmrchat-recovery-key-{n}.txt") };
        let path = dir.join(name);
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        match opts.open(&path) {
            Ok(mut f) => {
                f.write_all(contents.as_bytes()).map_err(|e| e.to_string())?;
                return Ok(path.to_string_lossy().into_owned());
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("Could not find a free file name in Downloads".into())
}

/// Write a diagnostic line from the web UI to stderr (CSP violations, uncaught errors).
/// The packaged app has no visible devtools console, so this is how problems surface.
#[tauri::command]
fn frontend_log(level: String, message: String) {
    let msg: String = message.chars().take(2000).collect();
    eprintln!("[murmrchat:{level}] {msg}");
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

/// Unread state from the UI, shown the native way on each platform:
///  - macOS:   Dock badge — a number for DMs + mentions, a dot for other unread messages.
///  - Windows: red dot overlay on the taskbar button, plus the tray icon and tooltip.
///  - Linux:   launcher badge count where the desktop supports it, plus the tray icon and tooltip.
#[tauri::command]
fn set_unread(app: tauri::AppHandle, window: tauri::WebviewWindow, count: u32, unread: bool) {
    #[cfg(target_os = "macos")]
    {
        let _ = &app;
        if count > 0 {
            let _ = window.set_badge_count(Some(count as i64));
        } else {
            let _ = window.set_badge_label(if unread { Some("•".to_string()) } else { None });
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let attention = count > 0 || unread;
        #[cfg(target_os = "windows")]
        {
            let overlay = if attention { tauri::image::Image::from_bytes(OVERLAY_ICON).ok() } else { None };
            let _ = window.set_overlay_icon(overlay);
        }
        #[cfg(target_os = "linux")]
        {
            let _ = window.set_badge_count(if count > 0 { Some(count as i64) } else { None });
        }
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            let icon = if attention { TRAY_ICON_UNREAD } else { TRAY_ICON };
            if let Ok(img) = tauri::image::Image::from_bytes(icon) {
                let _ = tray.set_icon(Some(img));
            }
            let tip = match (count, unread) {
                (0, false) => "MurmrChat".to_string(),
                (0, true) => "MurmrChat — unread messages".to_string(),
                (n, _) => format!("MurmrChat — {n} unread"),
            };
            let _ = tray.set_tooltip(Some(tip));
        }
    }
}

#[cfg(not(target_os = "macos"))]
const TRAY_ID: &str = "main";
#[cfg(not(target_os = "macos"))]
const TRAY_ICON: &[u8] = include_bytes!("../icons/tray/tray.png");
#[cfg(not(target_os = "macos"))]
const TRAY_ICON_UNREAD: &[u8] = include_bytes!("../icons/tray/tray-unread.png");
#[cfg(target_os = "windows")]
const OVERLAY_ICON: &[u8] = include_bytes!("../icons/tray/overlay.png");

/// Tray icon for Windows/Linux (macOS uses the Dock instead): click (Windows) or "Show" brings
/// the window back, "Quit" exits.
#[cfg(not(target_os = "macos"))]
fn create_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show = MenuItem::with_id(app, "show", "Show MurmrChat", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &PredefinedMenuItem::separator(app)?, &quit])?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(tauri::image::Image::from_bytes(TRAY_ICON)?)
        .tooltip("MurmrChat")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
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
        // Closing the window keeps MurmrChat running (syncing + notifying), like Mattermost:
        //  - macOS:   hide; the Dock icon brings it back, Cmd+Q quits.
        //  - Windows: hide to the tray; the tray icon brings it back, tray > Quit quits.
        //  - Linux:   minimize instead of hide — many desktops (e.g. stock GNOME) show no tray
        //             icons, and a hidden window would then be unreachable.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    #[cfg(target_os = "linux")]
                    let _ = window.minimize();
                    #[cfg(not(target_os = "linux"))]
                    let _ = window.hide();
                }
            }
        })
        .setup(|_app| {
            #[cfg(not(target_os = "macos"))]
            if let Err(e) = create_tray(_app) {
                eprintln!("[murmrchat:warn] could not create tray icon: {e}");
            }
            Ok(())
        })
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![secret_get, secret_set, secret_delete, save_recovery_key, frontend_log, set_unread])
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
