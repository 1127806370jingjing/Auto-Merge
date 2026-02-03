use hidapi::HidApi;
use std::{thread, time::Duration};

#[tauri::command]
pub async fn verify_device_pid(vid: u16, pid: u16, timeout_sec: u64) -> Result<bool, String> {
    let start = std::time::Instant::now();
    let timeout = Duration::from_secs(timeout_sec);

    while start.elapsed() < timeout {
        // 每次循环重新初始化 API 以获取最新设备列表
        let api = HidApi::new().map_err(|e| format!("HID Init Error: {}", e))?;

        for device in api.device_list() {
            if device.vendor_id() == vid && device.product_id() == pid {
                return Ok(true); // 找到了！
            }
        }

        // 没找到，休息 500ms 再找
        thread::sleep(Duration::from_millis(500));
    }

    Ok(false) // 超时未找到
}
