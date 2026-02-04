mod hid_monitor;
mod jflash;
mod hid;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            jflash::auto_detect_jflash,
            jflash::execute_merge_and_flash,
            hid_monitor::verify_device_pid,
            hid::scan_hid_devices,
            jflash::execute_flash_only
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
