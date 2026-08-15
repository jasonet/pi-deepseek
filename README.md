# Pi-Deepseek

<p align="center">
  <img src="./apps/website/public/icon.svg" width="96" height="96" alt="Pi-Deepseek" />
</p>

<p align="center">
  <strong>Deepseek harness Dual GUI app for elegant pi coding agent with pi-opendesign & local LLM</strong>
</p>

<p align="center">
  <a href="https://github.com/jasonet/pi-deepseek/releases/latest"><img src="https://img.shields.io/github/v/release/jasonet/pi-deepseek?label=release&color=%234D6BFE" alt="Latest Release" /></a>
  <a href="https://github.com/jasonet/pi-deepseek/releases/latest"><img src="https://img.shields.io/badge/platform-macOS_|_Windows_|_Linux-lightgrey" alt="Platform" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License" /></a>
</p>

---

## ⬇️ 下载 / Download

| 平台 | 架构 | 引擎 | 版本 | 格式 | 大小 | 下载 |
|------|------|------|------|------|------|------|
| **macOS** | Apple Silicon (M1–M4) | Electron | v2.8.1 | DMG | 137M | [![Download](https://img.shields.io/badge/Download-arm64-%234D6BFE?logo=apple)](https://github.com/jasonet/pi-deepseek/releases/download/v2.8.1/Pi-Deepseek-2.8.1-mac-arm64.dmg) |
| **macOS** | Intel (x64) | Electron | v2.8.1 | DMG | 148M | [![Download](https://img.shields.io/badge/Download-x64-%234D6BFE?logo=apple)](https://github.com/jasonet/pi-deepseek/releases/download/v2.8.1/Pi-Deepseek-2.8.1-mac-x64.dmg) |
| **macOS** | Apple Silicon (M1–M4) | Tauri | v2.8.0 | DMG | 115M | [![Download](https://img.shields.io/badge/Download-arm64-%237C6BF5?logo=apple)](https://github.com/jasonet/pi-deepseek/releases/download/v2.8.0/Pi-Deepseek-2.8.0-tauri-mac-arm64.dmg) |
| **Windows** | x64 | Electron | v2.6.9 | 安装版 | 121M | [![Download](https://img.shields.io/badge/Download-Setup-%234D6BFE?logo=windows)](https://github.com/jasonet/pi-deepseek/releases/download/v2.6.9/Pi-Deepseek-2.6.9-win-x64-setup.exe) |
| **Windows** | x64 | Electron | v2.6.9 | 便携版 | 120M | [![Download](https://img.shields.io/badge/Download-Portable-%234D6BFE?logo=windows)](https://github.com/jasonet/pi-deepseek/releases/download/v2.6.9/Pi-Deepseek-2.6.9-win-x64-portable.exe) |
| **Linux** | x64 | Electron | v2.6.9 | deb | 147M | [![Download](https://img.shields.io/badge/Download-.deb-%234D6BFE?logo=ubuntu)](https://github.com/jasonet/pi-deepseek/releases/download/v2.6.9/Pi-Deepseek-2.6.9-linux-amd64.deb) |
| **Linux** | x64 | Electron | v2.6.9 | AppImage | 150M | [![Download](https://img.shields.io/badge/Download-AppImage-%234D6BFE?logo=linux)](https://github.com/jasonet/pi-deepseek/releases/download/v2.6.9/Pi-Deepseek-2.6.9-linux-x86_64.AppImage) |

> **v2.8.1 发布 macOS Electron**：提供 Apple Silicon 与 Intel 版本；Tauri 保持 v2.8.0，Windows / Linux 暂保留 v2.6.9。
> *v2.8.1 ships for macOS Electron on Apple Silicon and Intel. Tauri remains on v2.8.0; Windows and Linux remain on v2.6.9.*

> 🧭 **双引擎版本矩阵 / Dual-engine version matrix:**
> **Electron `v2.8.1`**（macOS）与 **Tauri `v2.8.0`**（macOS arm64）。Electron 为日常使用推荐；Tauri 为更快启动的轻量替代。
> **Electron `v2.8.1`** (macOS) and **Tauri `v2.8.0`** (macOS arm64). Electron is recommended for daily use; Tauri is the faster-starting lightweight alternative.

> **v2.8.1 更新 / What's new:**
> **DeepSeek Key 安全互通**：Pi 保存的 Key 或用户环境变量可补全 DeepSeek Harness；Harness 的有效本地凭据也可补全缺失的 Pi 保存配置。环境变量仅读取、不回写；绝不将用户 Key 写入安装包或日志。
> **启动修复**：清除旧环境变量对 Harness 的只读覆盖，恢复 Models 页面编辑，并修复离线超时、并发修改与 `0600` 权限边界。
> *Secure, local-only credential sharing between Pi, user environment variables, and DeepSeek Harness, with editable Models settings and safer offline/concurrent behavior.*

> **v2.8.0 更新 / What's new:**
> **DeepSeek Harness**：新增内置 Harness Web 页签；本机服务未启动时，明确提示运行 `npx @deepseek-ai/dsh web`。
> **本地模型**：支持自定义 OpenAI 兼容供应商和本地 LLM 端点。
> **Tauri 稳定性**：修复 sidecar IPC 参数、Node runtime 打包及 `yaml` 运行时依赖。
> *Adds the embedded DeepSeek Harness tab and offline startup guidance, custom OpenAI-compatible local LLM providers, and Tauri sidecar/runtime packaging fixes.*

> 🆕 **v2.7.1 更新 / What's new:**
> 🐛 **修复**：同步 v2.7.0 性能优化基础上的增量修复。
> *Incremental fixes on top of the v2.7.0 performance overhaul.*

> 🆕 **v2.7.0 更新 / What's new:**
> ⚡ **性能优化**：代码分割（首屏 JS ↓49%）、8 个视图懒加载（Settings/Skills/Extensions/ConnectPhone/Terminal/Diff/Tree）、SessionRecord 快取跳过重建
> 🧠 **内存优化**：Transcript 缓存 LRU（上限 12 session）、Session data Maps 上限（64 + running）、移除 structuredClone 深拷贝、定期 GC
> 🛡️ **稳定性**：30 天 × 20 workspace 长期运行零洩漏验证通过
> *Performance & memory overhaul: code splitting (-49% initial JS), 8 lazy-loaded views, SessionRecord cache skipping, transcript LRU, bounded session data maps, periodic GC.*

> 🆕 **v2.6.9 新增 / What's new:**
> **包管理 Packages**：「扩展」面板新增 npm / git / 本地包的安装、更新与移除。
> **系统提示词补充 System-prompt additions**：可视化编辑项目级 `.pi/APPEND_SYSTEM.md` 与全局 `APPEND_SYSTEM.md`，自定义内容自动追加到系统提示词（项目优先，新建 / 重载会话生效）。
> *Packages management (install / update / remove npm · git · local packages) and a visual editor for project & global `APPEND_SYSTEM.md` system-prompt additions, both in the Extensions panel.*

> 💡 **macOS**：下载 `.dmg` 双击挂载，将 `Pi-Deepseek.app` 拖入 `/Applications`。
> **Windows**：`Setup.exe` 为安装版（推荐），`Portable.exe` 为绿色免安装版。
> **Linux**：Ubuntu/Debian/Deepin/UOS 用 `sudo dpkg -i xxx.deb` 安装；其他发行版用 `chmod +x xxx.AppImage && ./xxx.AppImage` 运行。
> 首次启动自动弹出设置引导，填入 DeepSeek API Key 即可开始。

> 💡 **macOS**: Download `.dmg`, double-click, drag `Pi-Deepseek.app` to `/Applications`.
> **Windows**: `Setup.exe` is the installer (recommended), `Portable.exe` runs directly.
> **Linux**: `sudo dpkg -i xxx.deb` for Ubuntu/Debian; `chmod +x xxx.AppImage && ./xxx.AppImage` for other distros.
> First launch auto-opens Settings for DeepSeek API key setup.

📦 [查看全部 Release & 校验文件 →](https://github.com/jasonet/pi-deepseek/releases/latest)

---

## 简介

`Pi-Deepseek` 利用 Pi coding agent 充分发挥 DeepSeek V4 Pro 的性价比（体验接近 Claude Opus 4.7，成本仅为其 N 分之一），一个面向本地 AI 编程工作流的桌面客户端。现已支持 macOS / Windows / Linux 三平台，为 `pi` 会话提供深推理、无提示词的 Codex 级工程自动交互体验。

![dual-pane](./docs/readme/dual-pane.jpg)

本项目在 [`pi-gui`](https://github.com/minghinmatthewlam/pi-gui) 的基础上持续开发，并通过 `@earendil-works/pi-coding-agent` 接入上游 `pi` 运行时。

![pi-deepseek demo](./docs/readme/demo.gif)

## 功能

- 桌面客户端中打开本地工作区，按工作区管理 `pi` 会话
- 创建新会话，通过 `pi` 运行时发送提示词
- 持久保存界面状态（工作区、会话、输入框草稿）
- Codex 风格的时间线与会话交互
- **内置 DeepSeek V4 Pro 1M / Flash 1M 模型**，一键配置 API Key
- **中文简体 / 中文繁體 / 日文 UI**，Settings → Appearance 即时切换
- **40+ 提供商品牌图标**，余额显示，紧凑布局
- **Open Design MCP 集成**（扩展 → Open Design → 查看 daemon 状态）
- **Cmd/Ctrl+Tab** 快速切换会话
- **自动更新**（Settings → Notifications → Auto Update）
- **双列布局**：同项目多会话并排显示，`Cmd+D` 分列 / `Cmd+W` 关列 / `Cmd+[` `Cmd+]` 切换 / 拖拽调整比例
- **包管理（Packages）** 🆕：在「扩展」面板为工作区安装 / 更新 / 移除 npm / git / 本地包
- **系统提示词补充** 🆕：在「扩展」面板编辑项目级 `.pi/APPEND_SYSTEM.md` 与全局 `APPEND_SYSTEM.md`，将自定义内容追加到 agent 系统提示词（项目文件优先于全局，对新建 / 重新加载的会话生效）
- **Dual-engine 统一版本**：Electron + Tauri 同步发版，版本号对齐

## Open Design 使用

```bash
# 安装 Open Design MCP（在终端执行一次）
cd ~/Sites/Github/open-design
pnpm install && pnpm rebuild better-sqlite3

# 启动 daemon
od --port 7456 --no-open

# 注册为 Pi MCP server
od mcp install pi
```

安装后在 Pi 对话中直接使用：
- "用 OD 做一个登录页"
- "生成一个 pitch deck"
- "把这个按钮改成蓝色"

Pi 会自动调用 OD 工具并在对话流中显示进度。

## 本地开发

```bash
corepack enable
pnpm install
pnpm dev
```

## 构建

```bash
# macOS 双架构
pnpm --filter @pi-gui/desktop run package

# Windows x64
pnpm --filter @pi-gui/desktop run package:win

# Linux x64 (AppImage + deb)
pnpm --filter @pi-gui/desktop run package:linux
```

## 目录结构

- `apps/desktop` — Electron 桌面应用
- `packages/session-driver` — 会话驱动类型
- `packages/catalogs` — 工作区与会话目录
- `packages/pi-sdk-driver` — pi-coding-agent 适配层

## 致谢

- 原始项目：[`minghinmatthewlam/pi-gui`](https://github.com/minghinmatthewlam/pi-gui)
- 上游运行时：[`earendil-works/pi`](https://github.com/earendil-works/pi)
- 编程智能体包：[`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)

## 许可证

MIT · [Yiding by HKEZ](https://github.com/jasonet) · Copyright 2026
