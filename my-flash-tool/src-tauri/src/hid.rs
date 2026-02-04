use hidapi::HidApi;
use serde::Serialize;

#[derive(Serialize)]
pub struct HidDeviceInfo {
    vid: u16,
    pid: u16,
    usage_page: u16,
    manufacturer: String,
    product: String,
    serial_number: String,
}

/// 扫描 HID 设备。默认仅显示 VID 0x373B 且 Usage Page 0xFF60 或 0xFF00 的设备。
/// filter_usage_pages: None 表示不过滤 usage_page；Some(vec![0xFF60, 0xFF00]) 为默认。
#[tauri::command]
pub fn scan_hid_devices(
    filter_vids: Option<Vec<u16>>,
    filter_usage_pages: Option<Vec<u16>>,
) -> Result<Vec<HidDeviceInfo>, String> {
    let filter_vids = filter_vids.unwrap_or(vec![0x373B]);
    let usage_pages: Option<std::collections::HashSet<u16>> = filter_usage_pages
        .filter(|v| !v.is_empty())
        .map(|v| v.into_iter().collect());
    let usage_pages = usage_pages.or_else(|| Some(vec![0xFF60, 0xFF00].into_iter().collect()));
    let api = HidApi::new().map_err(|e| format!("HID API Init Error: {}", e))?;
    let mut devices = Vec::new();
    for device in api.device_list() {
        if !filter_vids.contains(&device.vendor_id()) {
            continue;
        }
        let up = device.usage_page();
        if let Some(ref pages) = usage_pages {
            if !pages.contains(&up) {
                continue;
            }
        }
        let product = device
            .product_string()
            .map(|s| s.to_string())
            .unwrap_or_else(|| "Unknown".to_string());
        devices.push(HidDeviceInfo {
            vid: device.vendor_id(),
            pid: device.product_id(),
            usage_page: up,
            manufacturer: device.manufacturer_string().unwrap_or("Unknown").to_string(),
            product,
            serial_number: device.serial_number().unwrap_or("").to_string(),
        });
    }
    devices.sort_by(|a, b| (a.usage_page, a.pid).cmp(&(b.usage_page, b.pid)));
    Ok(devices)
}

/// 获取 HID 设备版本：用 Report ID 0 发送 [0x02, 0x96, 0x00]，即首字节 0x00 + 命令 02 96 00；返回格式 02 96 00 00 00 13 91，其中 13 91 表示 V13.91
#[tauri::command]
pub fn get_hid_device_version(
    vid: u16,
    pid: u16,
    serial: Option<String>,
) -> Result<String, String> {
    let api = HidApi::new().map_err(|e| format!("HID API Error: {}", e))?;
    let serial_ok = serial.as_deref();
    let device = api
        .device_list()
        .find(|d| {
            if d.vendor_id() != vid || d.product_id() != pid {
                return false;
            }
            match serial_ok {
                None => true,
                Some(s) if s.is_empty() => true,
                Some(s) => d.serial_number().map(|sn| sn == s).unwrap_or(false),
            }
        })
        .and_then(|d| d.open_device(&api).ok())
        .or_else(|| api.open(vid, pid).ok())
        .or_else(|| {
            serial
                .as_ref()
                .and_then(|s| api.open_serial(vid, pid, s.as_str()).ok())
        })
        .ok_or_else(|| "打开设备失败".to_string())?;
    let _ = device.set_blocking_mode(false);

    // Report ID 0 + 命令 02 96 00，共 4 字节
    const CMD_GET_VERSION: [u8; 4] = [0x00, 0x02, 0x96, 0x00];
    device.write(&CMD_GET_VERSION).map_err(|e| format!("发送指令失败: {}", e))?;

    std::thread::sleep(std::time::Duration::from_millis(150));

    let mut buf = [0u8; 64];
    let n = device.read_timeout(&mut buf[..], 1000).map_err(|e| format!("读取响应失败: {}", e))?;
    if n < 5 {
        return Err(format!("响应过短 ({} 字节)", n));
    }
    if let Some(v) = find_version_in_response(&buf[..n]) {
        return Ok(v);
    }
    // 部分设备响应稍慢，再读一次
    std::thread::sleep(std::time::Duration::from_millis(80));
    let n2 = device.read_timeout(&mut buf[..], 800).unwrap_or(0);
    find_version_in_response(&buf[..n2])
        .ok_or_else(|| format!("未找到版本 (首包 {} 字节)", n))
}

fn find_version_in_response(buf: &[u8]) -> Option<String> {
    let needle = [0x02u8, 0x96, 0x00];
    for i in 0..buf.len().saturating_sub(6) {
        if buf[i] == needle[0] && buf.get(i + 1) == Some(&needle[1]) && buf.get(i + 2) == Some(&needle[2]) {
            let v1 = *buf.get(i + 5)?;
            let v2 = *buf.get(i + 6)?;
            return Some(format!("V{:02X}.{:02X}", v1, v2));
        }
    }
    if buf.len() >= 8 {
        Some(format!("V{:02X}.{:02X}", buf[6], buf[7]))
    } else if buf.len() >= 7 {
        Some(format!("V{:02X}.{:02X}", buf[5], buf[6]))
    } else {
        None
    }
}