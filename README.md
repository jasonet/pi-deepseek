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
| **macOS** | Apple Silicon (M1–M5) | Electron | v3.0.5 | ZIP | 163 MB | [![Download](https://img.shields.io/badge/Download-arm64-%234D6BFE?logo=apple)](https://github.com/jasonet/pi-deepseek/releases/download/v3.0.5/Taosi-3.0.5-mac-arm64.zip) |
| **macOS** | Intel (x64) | Electron | v3.0.1 | DMG | 157 MB | [![Download](https://img.shields.io/badge/Download-x64-%234D6BFE?logo=apple)](https://github.com/jasonet/pi-deepseek/releases/download/v3.0.1/Taosi-3.0.1-mac-x64.dmg) |
| **macOS** | Apple Silicon (M1–M5) | Tauri | v3.0.1 | DMG | 147 MB | [![Download](https://img.shields.io/badge/Download-arm64-%237C6BF5?logo=apple)](https://github.com/jasonet/pi-deepseek/releases/download/v3.0.1/Taosi-3.0.1-tauri-mac-arm64.dmg) |
| **Windows** | x64 | Electron | v3.0.5 | 安装版 | 133 MB | [![Download](https://img.shields.io/badge/Download-Setup-%234D6BFE?logo=windows)](https://github.com/jasonet/pi-deepseek/releases/download/v3.0.5/Taosi-3.0.5-win-x64-setup.exe) |
| **Windows** | x64 | Electron | v3.0.5 | 便携版 | 132 MB | [![Download](https://img.shields.io/badge/Download-Portable-%234D6BFE?logo=windows)](https://github.com/jasonet/pi-deepseek/releases/download/v3.0.5/Taosi-3.0.5-win-x64-portable.exe) |
| **Linux** | x64 | Electron | v3.0.1 | deb | 157 MB | [![Download](https://img.shields.io/badge/Download-.deb-%234D6BFE?logo=ubuntu)](https://github.com/jasonet/pi-deepseek/releases/download/v3.0.1/Taosi-3.0.1-linux-amd64.deb) |
| **Linux** | x64 | Electron | v3.0.1 | AppImage | 161 MB | [![Download](https://img.shields.io/badge/Download-AppImage-%234D6BFE?logo=linux)](https://github.com/jasonet/pi-deepseek/releases/download/v3.0.1/Taosi-3.0.1-linux-x86_64.AppImage) |

> 🧭 **双引擎版本矩阵 / Dual-engine version matrix:**
> **Electron `v3.0.5`** 发布 macOS arm64 与 Windows x64（安装版与便携版）；Linux 与 Tauri 待对应构建完成后再更新下载链接。
> **Electron `v3.0.1`**（Linux）与 **Tauri `v3.0.1`**（macOS arm64）。macOS / Linux Electron 为完整双 harness 体验的推荐版本；Windows 因上游暂未提供 fx binary，当前为 Pi harness。
> **Electron `v3.0.1`** (macOS / Windows / Linux) and **Tauri `v3.0.1`** (macOS arm64). Electron is recommended for the complete dual-harness experience; About identifies the Electron / Tauri build.

> 🚀 **v3.x / v3.0.5 重大版本汇总 / Taosi 3.x Consolidated Highlights:**
> - **全新品牌与全平台重构（v3.0.0）**：正式升级更名为 **Taosi**；新增右侧**文件实时预览面板（File Preview Panel）**；原生支持 EasyCLIProxyAPI（OAuth with Claude, Antigravity, Codex, Kimi, xAI）及各类 OpenAI 兼容网关；全新顶栏折叠与长标题自适应交互。
> - **桌面自动化控制扩展（v3.0.5）**：内置集成 `@injaneity/pi-computer-use`，赋能 AI 智能体直接观察与操控操作系统桌面应用，支持屏幕截屏、UI 辅助功能树提取与精准键鼠交互。
> - **系统权限智能一键引导（v3.0.5）**：支持 macOS 辅助功能（Accessibility）与屏幕录制（Screen Recording）权限的实时双向检测与一键智能自动引导弹窗，切换系统设置后自动感知刷新，支持 Esc 紧急打断。
> - **多步工具调用单行实时滚屏（v3.0.4）**：多步工具执行折叠为单行实时滚屏（参考 Claude 体验），仅展示最新指令与状态，避免冗长刷屏，支持点击展开详情。
> - **输入框草稿保护与体验优化（v3.0.4）**：在输入框内切换模型或思考等级时，完整保留已输入的提示词草稿与文件/图片附件，不再清空。
> - **代码块折叠与语法高亮（v3.0.5）**：时间线代码块默认折叠显示语言标签、行数与首行预览，展开显示行号与语法高亮，支持一键复制代码。
> - **上下文压缩防挂起修复（v3.0.5）**：为全量模型提供 90s 超时防护与状态收敛流转，彻底解决长时间停留于 `Compacting conversation context... Working…` 不结束的问题。
> - **提供商与通知体验优化（v3.0.1 / v3.0.2）**：自定义供应商 API Key 安全遮罩并支持探测自动复用；长模型列表支持滚动；macOS 通知先显示状态类型标记，会话快捷键 Cmd+Tab 作用域隔离。
> *Consolidates the Taosi 3.x series: complete Taosi rebrand & file preview panel; @injaneity/pi-computer-use desktop automation; intelligent one-click macOS Accessibility & Screen Recording guidance; Claude-style rolling single-row tool execution; composer draft & attachment preservation across model switches; collapsible syntax-highlighted code blocks; and 90s timeout guard against conversation compaction hangs.*

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

### 核心基础功能
- **本地工作区与多会话管理**：在桌面客户端中打开本地目录，按工作区管理并持久化会话状态与输入草稿。
- **Codex 交互时间线**：流式消息响应、单行工具执行滚屏、代码块折叠高亮与智能排版。
- **内置模型与一键接入**：内置 DeepSeek V4 Pro 1M / Flash 1M 等主流模型，一键配置 API Key 快速启动。
- **全球化多语言**：支持中文简体、中文繁體、日文、英文 UI，设置（Settings → Appearance）中即时切换。
- **40+ 提供商与余额可视**：涵盖主流商业与开源大模型网关，紧凑布局与实时余额状态展示。
- **高效快捷键体系**：`Cmd/Ctrl+Tab` 快速切换展开会话，`Cmd+Enter` 重试消息，`Cmd+D` 双栏分列。
- **自动更新机制**：全平台版本对齐，Windows 安装版支持应用内静默差分更新与重启生效。
- **Open Design MCP 集成**：支持一键调度设计系统生成与修改网页/组件。

### 2.7 之后重点功能演进 (Major Milestones Since v2.7)

- **v2.8.0 阶段**：
  - **DeepSeek Harness Web UI 深度集成**：内置 Harness 嵌入页签，未启动本机服务时自动提示并引导执行 `npx @deepseek-ai/dsh web`。
  - **自定义本地与兼容模型端点**：全面放开自定义 OpenAI 兼容接口（llama.cpp, Ollama, LM Studio, vLLM 等本地端点）。
  - **Tauri 2 跨平台端侧内核加固**：侧边栏 IPC 参数对齐、内置 Node runtime 与 YAML 依赖打包优化。

- **v2.9.0 – v2.9.5 阶段**：
  - **Pi / fx 双 Harness 独立运行引擎**：双栏并排独立运行 Pi 与 Vercel fx 运行时；栏首一键切换左右位置；支持原生通道热切换（OpenAI Codex, xAI Grok, Vercel AI Gateway）与内置 fx 自动回退。
  - **OpenAI 兼容供应商（CLIProxyAPI）**：提供商设置升级支持 EasyCLIProxyAPI（OAuth with Claude, Antigravity, Codex, Kimi, xAI）认证网关。
  - **包管理与系统提示词补充**：在「扩展」面板为工作区安装/更新/移除 npm/git 包，支持项目级 `.pi/APPEND_SYSTEM.md` 系统提示词动态注入。
  - **Cmd+Enter 重试快捷键**：对话输入框及会话中新增 `Cmd+Enter`（Windows/Linux 为 `Ctrl+Enter`）一键重试上一条失败或历史消息。

- **v3.0.0 – v3.0.5 阶段（Taosi 3.x）**：
  - **全新品牌 Taosi 重构（v3.0.0）**：应用品牌全面升级为 **Taosi**；重构侧边栏长标题自适应、顶栏折叠与全球化界面。
  - **文件实时预览面板（v3.0.0）**：会话中提及的代码文件、Markdown 及多格式文档可在右侧独立分栏中即时预览与高亮。
  - **Computer Use 跨平台桌面自动化控制（v3.0.5）**：内置集成 `@injaneity/pi-computer-use`，AI 智能体可直接读取系统前台 UI 元素树、截屏与执行精准键鼠操控（点击、文本输入、按键、等待、浏览器观测）。
  - **系统权限智能一键自动引导（v3.0.5）**：macOS 辅助功能（Accessibility）与屏幕录制（Screen Recording）权限双向实时检测，一键智能引导弹窗开启并自动聚焦感知生效，支持 Esc 紧急中止。
  - **多步工具调用单行实时滚屏（v3.0.4）**：多步工具执行折叠为单行实时滚屏（参考 Claude 体验），仅展示最新指令，支持点击展开详情，避免冗长刷屏。
  - **输入框草稿保护（v3.0.4）**：在输入框内切换模型或思考等级时，完整保留已输入的提示词文本与图片/文件草稿，杜绝误清空。
  - **代码块折叠与语法高亮（v3.0.5）**：时间线代码块默认折叠行数并展示语言标签与首行预览，展开显示行号与语法高亮，支持一键复制代码。
  - **上下文压缩挂起修复（v3.0.5）**：全量模型提供 90s 超时防护与状态流转收敛，彻底解决长时间 `Compacting conversation context... Working…` 挂起卡死问题。
  - **模型配置安全与展示体验（v3.0.2）**：已保存的自定义 API Key 在设置中安全遮罩，探测时自动复用；长模型列表支持平滑滚动。

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
- 桌面控制扩展：[`injaneity/pi-computer-use`](https://github.com/injaneity/pi-computer-use) — Pi 扩展，赋能 AI 智能体跨平台观察与操控操作系统桌面应用

## 许可证

MIT · [Yiding by HKEZ](https://github.com/jasonet) · Copyright 2026
