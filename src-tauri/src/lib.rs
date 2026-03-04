// Tauri shell — kept intentionally minimal.
// All application logic lives in React. This file handles:
//   1. macOS activation policy (no dock icon, no app switcher)
//   2. Global hotkey (Cmd+Shift+L) to show/hide the panel
//   3. Invoke commands for reading local config (plugin detection)

use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

/// Read ~/.claude/plugins/installed_plugins.json for plugin detection.
/// Returns the raw JSON string; parsing happens in React.
#[tauri::command]
fn read_installed_plugins() -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let path = std::path::Path::new(&home).join(".claude/plugins/installed_plugins.json");
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![read_installed_plugins])
        .setup(|app| {
            // No dock icon, no app switcher — panel is an invisible utility
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Cmd+Shift+L — show or hide the panel from anywhere on the desktop
            let shortcut =
                Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyL);

            let app_handle = app.handle().clone();
            app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, _event| {
                if let Some(window) = app_handle.get_webview_window("main") {
                    match window.is_visible() {
                        Ok(true) => { let _ = window.hide(); }
                        _ => {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                }
            })?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
