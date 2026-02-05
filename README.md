# 烧录合并工具（Flash Merge Tool）

Bootloader + Application 合并为 HEX，配合 J-Flash 烧录。支持 **单次** / **批量** / **HEX 烧录**。

---

## 使用说明

### 1. 设置（首次使用必读）

左侧边栏点击 **设置**，配置会保存并自动生效。

#### J-Flash.exe 路径

常见位置（按版本选一个）：

```
C:\Program Files\SEGGER\JLink_Vxxx\JFlash.exe
```

**操作步骤：**

1. 资源管理器 → 进入 `C:\Program Files\SEGGER`
2. 在 `JLink_Vxxx` 文件夹中找到 **JFlash.exe**
3. 本工具设置里点击「J-Flash.exe」→ 选择该文件

#### J-Flash 项目文件（.jflash）

- **已有工程**：设置中选「Project File」直接选 .jflash。
- **需要新配置**：
  1. 单独打开 **SEGGER J-Flash**
  2. 配置芯片、接口、速率等
  3. 菜单 **File → Save project as...** 保存为 .jflash
  4. 回到本工具「Project File」中导入该文件

#### Boot Addr / App Addr

默认 `0x08000000` / `0x08020000`，在设置中按工程修改。

---

### 2. BOOT 与 APP 路径（可完全自定义）

| 模式 | 说明 |
|------|------|
| **单** | 点击 **Bootloader**、**Application**，在**任意路径**下选 BOOT/APP 文件（.bin / .hex）。 |
| **批** | 选 BOOT 目录、APP 目录（**任意路径**），工具按文件名自动配对；输出目录可自定义。 |

---

### 3. 功能入口

| 功能 | 说明 |
|------|------|
| **合并** | 单次 BOOT+APP → HEX，可烧录 |
| **批量** | 多对自动匹配合并 |
| **HEX 烧录** | 选 HEX 文件直接烧录 |
| **设置** | J-Flash、.jflash、地址 |

---

### 4. 使用前检查

- [x] 设置中已选 J-Flash.exe（建议到 `C:\Program Files\SEGGER` 下按版本选）
- [x] 已选或新建 .jflash；新配置先在 J-Flash 中保存再导入
- [x] Boot Addr、App Addr 与工程一致
- [x] BOOT/APP 路径可任意自定义

---

## 技术栈

- [Tauri](https://tauri.app/) + [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vitejs.dev/)
- 推荐 IDE：[VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
