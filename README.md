# Taosi

<p align="center">
  <img src="./apps/website/public/icon.svg" width="96" height="96" alt="Taosi" />
</p>

<p align="center">
  <strong>Taosi 3.0 pi/fx elegant harness GUI with DeepSeek Harness(Official) local LLM and CLIProxyAPI/EasyCLIProxyAPI OAuth</strong>
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
| **macOS** | Apple Silicon (M1–M5) | Electron | v3.0.0 | DMG | 145 MB | [![Download](https://img.shields.io/badge/Download-arm64-%234D6BFE?logo=apple)](https://github.com/jasonet/pi-deepseek/releases/download/v3.0.0/Taosi-3.0.0-mac-arm64.dmg) |
| **macOS** | Intel (x64) | Electron | v3.0.0 | DMG | 157 MB | [![Download](https://img.shields.io/badge/Download-x64-%234D6BFE?logo=apple)](https://github.com/jasonet/pi-deepseek/releases/download/v3.0.0/Taosi-3.0.0-mac-x64.dmg) |
| **macOS** | Apple Silicon (M1–M5) | Tauri | v3.0.0 | DMG | 147 MB | [![Download](https://img.shields.io/badge/Download-arm64-%237C6BF5?logo=apple)](https://github.com/jasonet/pi-deepseek/releases/download/v3.0.0/Taosi-3.0.0-tauri-mac-arm64.dmg) |
| **Windows** | x64 | Electron | v3.0.0 | 安装版 | 125 MB | [![Download](https://img.shields.io/badge/Download-Setup-%234D6BFE?logo=windows)](https://github.com/jasonet/pi-deepseek/releases/download/v3.0.0/Taosi-3.0.0-win-x64-setup.exe) |
| **Windows** | x64 | Electron | v3.0.0 | 便携版 | 125 MB | [![Download](https://img.shields.io/badge/Download-Portable-%234D6BFE?logo=windows)](https://github.com/jasonet/pi-deepseek/releases/download/v3.0.0/Taosi-3.0.0-win-x64-portable.exe) |
| **Linux** | x64 | Electron | v3.0.0 | deb | 157 MB | [![Download](https://img.shields.io/badge/Download-.deb-%234D6BFE?logo=ubuntu)](https://github.com/jasonet/pi-deepseek/releases/download/v3.0.0/Taosi-3.0.0-linux-amd64.deb) |
| **Linux** | x64 | Electron | v3.0.0 | AppImage | 161 MB | [![Download](https://img.shields.io/badge/Download-AppImage-%234D6BFE?logo=linux)](https://github.com/jasonet/pi-deepseek/releases/download/v3.0.0/Taosi-3.0.0-linux-x86_64.AppImage) |

> 🧭 **双引擎版本矩阵 / Dual-engine version matrix:**
> **Electron `v3.0.0`**（macOS / Windows / Linux）与 **Tauri `v3.0.0`**（macOS arm64）。macOS / Linux Electron 为完整双 harness 体验的推荐版本；Windows 因上游暂未提供 fx binary，当前为 Pi harness。
> **Electron `v3.0.0`** (macOS / Windows / Linux) and **Tauri `v3.0.0`** (macOS arm64). Electron is recommended for the complete dual-harness experience; About identifies the Electron / Tauri build.

> 🚀 **v3.0.0 重大更新 / Major Release — 全新品牌 Taosi 与全平台重构:**
> **全新品牌 Taosi**：应用正式更名为 **Taosi**，全面升级品牌标识与多语言支持。
> **文件预览面板（File Preview Panel）**：支持在应用右侧实时预览会话中提及的代码文件、Markdown 以及多格式文档。
> **OpenAI 兼容供应商（CLIProxyAPI）**：提供商设置升级支持 EasyCLIProxyAPI（OAuth with Claude, Antigravity, Codex, Kimi, xAI）、llama.cpp、Ollama、LM Studio、vLLM 等兼容网关。
> **会话列表与顶栏交互升级**：会话列表引入内嵌引擎图标及自适应长标题展示；侧边栏折叠按钮移入顶栏，收起时依然随时可用。
> **时间线滚动优化与更新友好化**：彻底修复长 URL 导致的页面横向滚动与抖动，更新提示增加关闭/稍后操作与更友好的错误提示。
> *Major release rebrands Pi-Deepseek to **Taosi** across all platforms. Introduces interactive file preview panel, full OpenAI-compatible / CLIProxyAPI provider support, redesigned session list & topbar sidebar toggle, robust timeline anti-jitter, and user-friendly update dialog controls.*

> **v2.9.5 更新 / What's new:**
> **OpenAI 兼容供应商（CLIProxyAPI）**：提供商设置升级支持 EasyCLIProxyAPI（OAuth with Claude, Antigravity, Codex, Kimi, xAI）、llama.cpp、Ollama、LM Studio、vLLM 等兼容网关。
> **运行引擎布局修复**：彻底修复运行引擎（Harnesses）设置中 Pi「默认模型」与推理等级标签被挤压、换行异常的视觉问题。
> **Cmd+Enter 重试快捷键**：对话输入框及会话中新增 `Cmd+Enter`（Windows/Linux 为 `Ctrl+Enter`）一键重试上一条失败或历史消息，并在通用快捷键设置中完整展示。
> *Provider settings upgraded to OpenAI-compatible provider (CLIProxyAPI) supporting EasyCLIProxyAPI (OAuth with Claude, Antigravity, Codex, Kimi, xAI). Fixed cramped layout for Pi default model in Harness settings. Added Cmd+Enter (Ctrl+Enter) shortcut to retry the last message in conversations.*

> **v2.9.0 更新 / What's new:**
> **Pi/fx 双 harness 引擎**：支持在双栏中并排运行 Pi 与 fx；每栏左上角显示引擎图标与名称，并可直接交换两套独立 runtime 的左右位置。
> **内置 fx**：优先复用系统 fx 及其现有登录，找不到或不兼容时自动回退到应用内置、校验过的 fx runtime。
> **三平台 Electron 构建**：macOS、Windows、Linux 统一为 2.9.0；上游尚无 Windows fx binary，因此 Windows 保留 Pi harness 并明确提示 fx 不可用。
> *Pi and fx can run side by side in dual-pane mode, with visible per-pane engine controls that swap the independent runtimes. The app reuses a compatible system fx login first and falls back to the verified bundled runtime on supported platforms.*

> **v2.8.0 更新 / What's new:**
> **DeepSeek Harness**：新增内置 Harness Web 页签；本机服务未启动时，明确提示运行 `npx @deepseek-ai/dsh web`。
> **本地模型**：支持自定义 OpenAI 兼容供应商和本地 LLM 端点。
> **Tauri 稳定性**：修复 sidecar IPC 参数、Node runtime 打包及 `yaml` 运行时依赖。
> *Adds the embedded DeepSeek Harness tab and offline startup guidance, custom OpenAI-compatible local LLM providers, and Tauri sidecar/runtime packaging fixes.*

> 🆕 **v2.7.0 更新 / What's new:**
> ⚡ **性能优化**：代码分割（首屏 JS ↓49%）、8 个视图懒加载（Settings/Skills/Extensions/ConnectPhone/Terminal/Diff/Tree）、SessionRecord 快取跳过重建
> 🧠 **内存优化**：Transcript 缓存 LRU（上限 12 session）、Session data Maps 上限（64 + running）、移除 structuredClone 深拷贝、定期 GC
> 🛡️ **稳定性**：30 天 × 20 workspace 长期运行零洩漏验证通过
> *Performance & memory overhaul: code splitting (-49% initial JS), 8 lazy-loaded views, SessionRecord cache skipping, transcript LRU, bounded session data maps, periodic GC.*

> 💡 **macOS**：下载 `.dmg` 双击挂载，将 `Taosi.app` 拖入 `/Applications`。
> **Windows**：`Setup.exe` 为安装版（推荐），`Portable.exe` 为绿色免安装版。
> **Linux**：Ubuntu/Debian/Deepin/UOS 用 `sudo dpkg -i xxx.deb` 安装；其他发行版用 `chmod +x xxx.AppImage && ./xxx.AppImage` 运行。
> 首次启动自动弹出设置引导，填入 DeepSeek API Key 即可开始。

📦 [查看全部 Release & 校验文件 →](https://github.com/jasonet/pi-deepseek/releases/latest)

---

## 简介

`Taosi` 利用 Pi/fx coding agent 充分发挥 DeepSeek V4 Pro/Flash（DeepSeek已经失去性价比，目前首推codex订阅，fx可以无缝login openai codex/grok），同时内置了DeepSeek Harness Web UI（npx @deepseek-ai/dsh web），一个面向本地 AI 编程工作流的桌面客户端。现已支持 macOS / Windows / Linux 三平台，为 pi和fx 会话提供深推理、无提示词的 Agent 级工程自动交互体验。

![dual-pane](./docs/readme/dual-pane.jpg)

## Pi 与 fx 的主要区别 / Pi vs fx

| 能力 | Pi harness | fx harness |
|---|---|---|
| Runtime | 应用内的 `pi-mono` / `pi-coding-agent` 运行时 | Vercel fx 原生程序，通过 ACP 接入 |
| 强项 | 完整工具、Skills、Extensions、图片/文件附件、队列与 steer、自定义/本地模型 | 独立上下文与模型会话、快速并行验证、复用现有 fx 登录与配置 |
| 会话 | Pi 原生会话格式，由桌面端薄封装管理 | fx 原生 session，由 fx 自己保存和恢复 |
| 适合 | 主工程实现、深度仓库操作、需要 Pi 扩展生态的任务 | 第二意见、独立方案、并行分析与 fx 工作流 |

2.9 新增 **Pi/fx 双 harness 引擎**。新建会话默认使用 Pi，也可在项目选择框右侧切换为 fx；每次只启动所选 harness。已有 Pi/fx 会话仍可在双栏中并排使用，栏首图标会说明当前 harness，并可交换左右位置。两者共享项目目录和桌面会话目录，但不合并上下文、认证或 runtime。

在 2.9.2 中，设置 → Harnesses 可视化显示 fx 的 Vercel AI Gateway、OpenAI Codex 与 xAI Grok 连接状态，并通过 fx 原生登录流程打开浏览器。仅“使用此渠道”会切换 fx 活跃渠道；连接账号后应用会恢复原渠道。新建 fx 会话从当前 fx 渠道读取模型；Pi 已配置的本地 OpenAI 兼容模型也会出现在模型菜单中，选择后界面会切回 Pi，因为上游 fx 当前只支持 Gateway、Codex 和 Grok，不能直接运行本地模型。

Version 2.9 adds the **Pi/fx dual-harness engine**. New threads default to Pi and can switch to fx beside the workspace picker; only the selected harness starts. Existing Pi/fx sessions can still run side by side, with pane-header icons identifying each harness and allowing position swaps. Both harnesses share the project directory and desktop catalog, but keep runtime, authentication, context, and native session storage independent.

In 2.9.2, Settings → Harnesses shows fx connection state for Vercel AI Gateway, OpenAI Codex, and xAI Grok and launches fx's native browser login. Connecting an account restores the previously active provider; only “Use” changes it. New fx threads load the active fx model catalog. Pi-configured local OpenAI-compatible models also appear in the picker and visibly switch back to Pi, because upstream fx currently supports Gateway, Codex, and Grok rather than direct local-model endpoints.

本项目在 [`pi-gui`](https://github.com/minghinmatthewlam/pi-gui) 的基础上持续开发，并通过 `@earendil-works/pi-coding-agent` 接入上游 `pi` 运行时。

![pi-deepseek demo](./docs/readme/demo.gif)

### DeepSeek Harness 数据图分析（15 张数据图了解 DeepSeek Harness）

<video src="./docs/readme/pi-deepseek-demo.mp4" controls width="540"></video>

> 来源：[15 张数据图帮你了解 DeepSeek Harness — @op7418（歸藏）](https://x.com/op7418/status/2088199058313957734)
> Source: [15 charts to understand DeepSeek Harness — @op7418 (guizang.ai)](https://x.com/op7418/status/2088199058313957734)

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
- **自动更新**（Settings → Notifications → Auto Update）：Windows 安装版支持应用内通知、下载进度和完成后重启；有可用 blockmap 与本地旧安装包缓存时使用差分下载，否则安全回退为完整更新包
- **Pi/fx 双 harness**：新会话默认 Pi、可切换 fx；已有会话可用双列布局并交换左右位置，`Cmd+D` 分列 / `Cmd+W` 关列 / `Cmd+[` `Cmd+]` 切换 / 拖拽调整比例
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
- fx 引擎：[`vercel-labs/fx`](https://github.com/vercel-labs/fx) — Vercel 官方 AI coding agent，通过 ACP 接入双 harness 工作流
- DeepSeek Harness：[`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) — DeepSeek 官方开发环境，支持扩展 / 插件体系与 Harness Web UI
- 编程智能体包：[`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)

## 许可证

MIT · [Yiding by HKEZ](https://github.com/jasonet) · Copyright 2026
