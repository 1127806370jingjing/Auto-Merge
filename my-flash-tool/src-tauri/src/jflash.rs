use std::path::Path;
use std::process::Command;
use std::fs;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use winreg::enums::*;
use winreg::RegKey;

// ⚠️ 调试完成后，在 Command 上使用 .raw_arg(CREATE_NO_WINDOW.to_string()) 可隐藏黑框
#[allow(dead_code)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[tauri::command]
pub fn auto_detect_jflash() -> Result<String, String> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let key_paths = ["SOFTWARE\\SEGGER\\J-Link", "SOFTWARE\\WOW6432Node\\SEGGER\\J-Link"];
    for key_path in key_paths {
        if let Ok(key) = hklm.open_subkey(key_path) {
            if let Ok(install_path) = key.get_value::<String, _>("InstallPath") {
                let exe_path = Path::new(&install_path).join("JFlash.exe");
                if exe_path.exists() { return Ok(exe_path.to_string_lossy().to_string()); }
            }
        }
    }
    let common_paths = [r"C:\Program Files\SEGGER\JLink\JFlash.exe", r"C:\Program Files (x86)\SEGGER\JLink\JFlash.exe"];
    for path in common_paths {
        if Path::new(path).exists() { return Ok(path.to_string()); }
    }
    Err("未检测到 J-Flash".into())
}

#[tauri::command]
pub async fn execute_merge_and_flash(
    jflash_path: String, project_path: String, boot_path: String, app_path: String, output_path: String,
    mut boot_addr: String, mut app_addr: String, only_merge: bool
) -> Result<String, String> {
    
    // 1. 基础环境检查
    if !Path::new(&jflash_path).exists() { return Err("找不到 JFlash.exe".into()); }
    
    // 自动创建输出文件夹 (关键!)
    if let Some(parent) = Path::new(&output_path).parent() {
        if !parent.exists() {
            let _ = fs::create_dir_all(parent);
        }
    }

    // 2. 地址格式化 (防止 J-Flash 认为是十进制)
    if !boot_addr.to_lowercase().starts_with("0x") { boot_addr = format!("0x{}", boot_addr); }
    if !app_addr.to_lowercase().starts_with("0x") { app_addr = format!("0x{}", app_addr); }

    // 3. 清理旧文件
    if only_merge {
        let _ = fs::remove_file(&output_path);
    }

    // 4. 构造指令 (⚡️ 修复点：移除了所有 \" )
    // Rust 会自动处理含空格的路径，不需要我们手动加引号
    let mut args = vec![
        format!("-openprj{}", project_path),
        format!("-open{},{}", boot_path, boot_addr),
        format!("-merge{},{}", app_path, app_addr),
        format!("-saveas{}", output_path),
    ];

    if only_merge {
        // 批量生成模式：不烧录，生成完直接退出
        args.push("-exit".to_string());
    } else {
        // 单文件烧录模式：自动烧录 -> 退出
        args.push("-auto".to_string());
        args.push("-exit".to_string());
    }

    // 5. 执行
    let mut cmd = Command::new(&jflash_path);
    cmd.args(&args);
    // cmd.raw_arg(CREATE_NO_WINDOW.to_string()); // 调试通过后可取消注释

    let output = cmd.output().map_err(|e| format!("启动进程失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    // 6. 结果判定
    if only_merge {
        // 只要文件存在，就是成功
        if Path::new(&output_path).exists() {
            Ok(format!("🎉 合并成功: {}", output_path))
        } else {
            Err(format!("❌ 失败: 结果文件未生成\nCMD: {} {}\n日志: {}\n{}", 
                jflash_path, args.join(" "), stdout, stderr))
        }
    } else {
        // 烧录模式检查关键字
        if stdout.contains("Data file saved successfully") || stdout.contains("OK") {
             Ok(format!("🎉 烧录流程完成\n{}", stdout))
        } else {
             Err(format!("❌ 流程可能失败\nCMD: {} {}\n日志: {}\n{}", 
                jflash_path, args.join(" "), stdout, stderr))
        }
    }
}

// 🆕 单独烧录验证：Open Project -> Open Data(HEX) -> Auto -> Exit
// J-Flash 官方语法：-openprj<path> -open<path>[,addr] -auto -exit（HEX 一般不需地址）
#[tauri::command]
pub async fn execute_flash_only(
    jflash_path: String,
    project_path: String,
    hex_path: String
) -> Result<String, String> {
    
    if !Path::new(&jflash_path).exists() { return Err("未找到 J-Flash 程序".into()); }
    if !Path::new(&hex_path).exists() { return Err("找不到 HEX 文件".into()); }

    // 与 execute_merge_and_flash 一致：不手动加引号，由 Command 传参（路径含空格时系统会处理）
    let args = vec![
        format!("-openprj{}", project_path),
        format!("-open{}", hex_path),
        "-auto".to_string(),
        "-exit".to_string()
    ];

    let output = Command::new(&jflash_path)
        .args(&args)
        .raw_arg(CREATE_NO_WINDOW.to_string())
        .output()
        .map_err(|e| format!("启动 J-Flash 失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let all_out = format!("{}\n{}", stdout, stderr);

    // 显式失败关键词：有则判为失败
    if all_out.contains("Could not connect") || all_out.contains("Connection failed") || all_out.contains("Communication timed out") {
        return Err(format!("⚠️ J-Flash 未连接成功\n请检查 J-Link 与芯片连接、电源。\n\nstdout:\n{}\nstderr:\n{}", stdout, stderr));
    }
    if all_out.contains("Failed") && (all_out.contains("Error") || all_out.contains("error")) {
        return Err(format!("❌ 烧录失败\nCMD: {} {}\n\nstdout:\n{}\n\nstderr:\n{}", jflash_path, args.join(" "), stdout, stderr));
    }

    // 成功判定：进程退出码 0 即视为成功（无窗口模式下 J-Flash 常不写 stdout/stderr）
    if output.status.success() {
        return Ok(if all_out.trim().is_empty() {
            "✨ 烧录成功".into()
        } else {
            format!("✨ 烧录成功\n{}", all_out.trim())
        });
    }

    // 退出码非 0 才报失败
    Err(format!(
        "❌ 烧录失败 (退出码 {:?})\nCMD: {} {}\n\nstdout:\n{}\n\nstderr:\n{}",
        output.status.code(), jflash_path, args.join(" "), stdout, stderr
    ))
}