mod capture;
mod debug_log;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            capture::capture_primary_monitor_png,
            capture::capture_window_png,
            capture::list_capture_windows,
            debug_log::set_debug_logging_enabled,
            debug_log::write_debug_log,
            debug_log::open_debug_log_folder,
            debug_log::save_ai_debug_image,
        ])
        .manage(debug_log::DebugLogState::default())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
