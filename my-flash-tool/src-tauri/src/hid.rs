use hidapi::HidApi;
use serde::Serialize;

#[derive(Serialize)]
pub struct HidDeviceInfo {
    vid: u16,
    pid: u16,
    manufacturer: String,
    product: String,
    serial_number: String,
}

#[tauri::command]
pub fn scan_hid_devices(filter_vids: Option<Vec<u16>>) -> Result<Vec<HidDeviceInfo>, String> {
    let filter_vids = filter_vids.unwrap_or(vec![0x373B]);
    let api = HidApi::new().map_err(|e| format!("HID API Init Error: {}", e))?;
    let mut devices = Vec::new();
    for device in api.device_list() {
        if !filter_vids.contains(&device.vendor_id()) {
            continue;
        }
        if let Some(prod) = device.product_string() {
            devices.push(HidDeviceInfo {
                vid: device.vendor_id(),
                pid: device.product_id(),
                manufacturer: device.manufacturer_string().unwrap_or("Unknown").to_string(),
                product: prod.to_string(),
                serial_number: device.serial_number().unwrap_or("").to_string(),
            });
        }
    }
    
    // 按 PID 排序方便查看
    devices.sort_by(|a, b| a.pid.cmp(&b.pid));
    Ok(devices)
}