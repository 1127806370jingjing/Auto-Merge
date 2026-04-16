use hidapi::{DeviceInfo, HidApi};
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

trait DeviceMatchInfo {
    fn vendor_id(&self) -> u16;
    fn product_id(&self) -> u16;
    fn usage_page(&self) -> u16;
    fn serial_number(&self) -> Option<&str>;
}

impl DeviceMatchInfo for DeviceInfo {
    fn vendor_id(&self) -> u16 {
        self.vendor_id()
    }

    fn product_id(&self) -> u16 {
        self.product_id()
    }

    fn usage_page(&self) -> u16 {
        self.usage_page()
    }

    fn serial_number(&self) -> Option<&str> {
        self.serial_number()
    }
}

fn pick_device_candidate<'a, T: DeviceMatchInfo>(
    devices: &'a [T],
    vid: u16,
    pid: u16,
    serial: Option<&str>,
    usage_page: Option<u16>,
) -> Option<&'a T> {
    let serial = serial.filter(|value| !value.is_empty());

    devices.iter().find(|device| {
        if device.vendor_id() != vid || device.product_id() != pid {
            return false;
        }

        if let Some(expected_usage_page) = usage_page {
            if device.usage_page() != expected_usage_page {
                return false;
            }
        }

        match serial {
            None => true,
            Some(expected_serial) => device
                .serial_number()
                .map(|actual_serial| actual_serial == expected_serial)
                .unwrap_or(false),
        }
    })
}

fn open_matching_device(
    api: &HidApi,
    vid: u16,
    pid: u16,
    serial: Option<&str>,
    usage_page: Option<u16>,
) -> Result<hidapi::HidDevice, String> {
    let devices: Vec<_> = api.device_list().cloned().collect();
    pick_device_candidate(&devices, vid, pid, serial, usage_page)
        .and_then(|device| device.open_device(api).ok())
        .ok_or_else(|| "打开设备失败".to_string())
}

#[tauri::command]
pub fn scan_hid_devices(
    filter_vids: Option<Vec<u16>>,
    filter_usage_pages: Option<Vec<u16>>,
) -> Result<Vec<HidDeviceInfo>, String> {
    let filter_vids = filter_vids.unwrap_or(vec![0x373B]);
    let usage_pages: Option<std::collections::HashSet<u16>> = filter_usage_pages
        .filter(|pages| !pages.is_empty())
        .map(|pages| pages.into_iter().collect());
    let usage_pages =
        usage_pages.or_else(|| Some(vec![0xFF60, 0xFF00].into_iter().collect()));

    let api = HidApi::new().map_err(|e| format!("HID API Init Error: {}", e))?;
    let mut devices = Vec::new();

    for device in api.device_list() {
        if !filter_vids.contains(&device.vendor_id()) {
            continue;
        }

        let usage_page = device.usage_page();
        if let Some(ref pages) = usage_pages {
            if !pages.contains(&usage_page) {
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
            usage_page,
            manufacturer: device
                .manufacturer_string()
                .unwrap_or("Unknown")
                .to_string(),
            product,
            serial_number: device.serial_number().unwrap_or("").to_string(),
        });
    }

    devices.sort_by(|a, b| (a.usage_page, a.pid).cmp(&(b.usage_page, b.pid)));
    Ok(devices)
}

#[tauri::command]
pub fn get_hid_device_version(
    vid: u16,
    pid: u16,
    serial: Option<String>,
    usage_page: Option<u16>,
) -> Result<String, String> {
    let api = HidApi::new().map_err(|e| format!("HID API Error: {}", e))?;
    let device = open_matching_device(&api, vid, pid, serial.as_deref(), usage_page)?;
    let _ = device.set_blocking_mode(false);

    const CMD_GET_VERSION: [u8; 4] = [0x00, 0x02, 0x96, 0x00];
    device
        .write(&CMD_GET_VERSION)
        .map_err(|e| format!("发送指令失败: {}", e))?;

    std::thread::sleep(std::time::Duration::from_millis(150));

    let mut buf = [0u8; 64];
    let n = device
        .read_timeout(&mut buf[..], 1000)
        .map_err(|e| format!("读取响应失败: {}", e))?;
    if n < 5 {
        return Err(format!("响应过短 ({} 字节)", n));
    }
    if let Some(v) = find_version_in_response(&buf[..n]) {
        return Ok(v);
    }

    std::thread::sleep(std::time::Duration::from_millis(80));
    let n2 = device.read_timeout(&mut buf[..], 800).unwrap_or(0);
    find_version_in_response(&buf[..n2]).ok_or_else(|| format!("未找到版本 (首包 {} 字节)", n))
}

#[tauri::command]
pub fn switch_hid_to_boot_mode(
    vid: u16,
    pid: u16,
    serial: Option<String>,
    usage_page: Option<u16>,
) -> Result<(), String> {
    let api = HidApi::new().map_err(|e| format!("HID API Error: {}", e))?;
    let device = open_matching_device(&api, vid, pid, serial.as_deref(), usage_page)?;

    const CMD_BOOT: [u8; 4] = [0x00, 0xF0, 0x01, 0xF1];
    device
        .write(&CMD_BOOT)
        .map_err(|e| format!("发送指令失败: {}", e))?;
    Ok(())
}

fn find_version_in_response(buf: &[u8]) -> Option<String> {
    let needle = [0x02u8, 0x96, 0x00];
    for i in 0..buf.len().saturating_sub(6) {
        if buf[i] == needle[0]
            && buf.get(i + 1) == Some(&needle[1])
            && buf.get(i + 2) == Some(&needle[2])
        {
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

#[cfg(test)]
mod tests {
    use super::DeviceMatchInfo;

    #[derive(Clone, Debug)]
    struct DeviceCandidate<'a> {
        vid: u16,
        pid: u16,
        usage_page: u16,
        serial: &'a str,
        tag: &'a str,
    }

    impl DeviceMatchInfo for DeviceCandidate<'_> {
        fn vendor_id(&self) -> u16 {
            self.vid
        }

        fn product_id(&self) -> u16 {
            self.pid
        }

        fn usage_page(&self) -> u16 {
            self.usage_page
        }

        fn serial_number(&self) -> Option<&str> {
            Some(self.serial)
        }
    }

    #[test]
    fn prefers_exact_usage_page_match_for_same_vid_pid_and_serial() {
        let candidates = vec![
            DeviceCandidate {
                vid: 0x373B,
                pid: 0x1234,
                usage_page: 0xFF00,
                serial: "ABC",
                tag: "ff00",
            },
            DeviceCandidate {
                vid: 0x373B,
                pid: 0x1234,
                usage_page: 0xFF60,
                serial: "ABC",
                tag: "ff60",
            },
        ];

        let selected = super::pick_device_candidate(
            &candidates,
            0x373B,
            0x1234,
            Some("ABC"),
            Some(0xFF60),
        )
        .expect("should select a matching device");

        assert_eq!(selected.tag, "ff60");
    }

    #[test]
    fn ignores_serial_when_request_serial_is_empty() {
        let candidates = vec![DeviceCandidate {
            vid: 0x373B,
            pid: 0x1234,
            usage_page: 0xFF60,
            serial: "",
            tag: "target",
        }];

        let selected = super::pick_device_candidate(
            &candidates,
            0x373B,
            0x1234,
            Some(""),
            Some(0xFF60),
        )
        .expect("should match empty serial as wildcard");

        assert_eq!(selected.tag, "target");
    }
}
