# Pi-Deepseek

<p align="center">
  <img src="./apps/website/public/icon.svg" width="96" height="96" alt="Pi-Deepseek" />
</p>

<p align="center">
  <strong>Deepseek GUI app for elegant pi coding agent</strong>
</p>

<p align="center">
  <a href="https://github.com/jasonet/pi-deepseek/releases/latest"><img src="https://img.shields.io/github/v/release/jasonet/pi-deepseek?label=latest&color=%234D6BFE" alt="Latest Release" /></a>
  <a href="https://github.com/jasonet/pi-deepseek/releases/latest"><img src="https://img.shields.io/badge/platform-macOS-lightgrey?logo=apple" alt="Platform" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License" /></a>
</p>

---

## ⬇️ 下载 / Download

| 架构 | 格式 | 下载 |
|------|------|------|
| **Apple Silicon** (M1–M4) | DMG | [![Download DMG](https://img.shields.io/badge/Download-arm64.dmg-%234D6BFE?logo=apple)](https://github.com/jasonet/pi-deepseek/releases/download/v0.2.0-beta/pi-deepseek-0.2.0-beta-arm64.dmg) |
| **Apple Silicon** (M1–M4) | ZIP | [![Download ZIP](https://img.shields.io/badge/Download-arm64.zip-%234D6BFE)](https://github.com/jasonet/pi-deepseek/releases/download/v0.2.0-beta/pi-deepseek-0.2.0-beta-arm64.zip) |
| **Intel Mac** (x64) | DMG | [![Download DMG](https://img.shields.io/badge/Download-x64.dmg-%234D6BFE?logo=apple)](https://github.com/jasonet/pi-deepseek/releases/download/v0.2.0-beta/pi-deepseek-0.2.0-beta-x64.dmg) |
| **Intel Mac** (x64) | ZIP | [![Download ZIP](https://img.shields.io/badge/Download-x64.zip-%234D6BFE)](https://github.com/jasonet/pi-deepseek/releases/download/v0.2.0-beta/pi-deepseek-0.2.0-beta-x64.zip) |

> 💡 下载 `.dmg` 后双击挂载，将 `Pi-Deepseek.app` 拖入 `/Applications` 即可。首次启动自动引导配置 DeepSeek API Key。
>
> 💡 Download the `.dmg`, double-click to mount, and drag `Pi-Deepseek.app` into `/Applications`. First launch auto-guides DeepSeek API key setup.

📦 [查看全部 Release & 校验文件 →](https://github.com/jasonet/pi-deepseek/releases/latest)

---

## 简介

`Pi-Deepseek` 是一个面向本地 AI 编程工作流的桌面客户端，为 `pi` 会话提供接近 Codex 的桌面交互体验。

本项目在 [`pi-gui`](https://github.com/minghinmatthewlam/pi-gui) 的基础上持续开发，并通过 `@earendil-works/pi-coding-agent` 接入上游 `pi` 运行时。它不是一个独立的编程智能体运行时：会话管理、模型与认证配置、智能体执行等核心能力仍由上游 `pi` 提供。

![pi-deepseek 演示](./docs/readme/demo.gif)

## 功能

- 在桌面客户端中打开本地工作区
- 按工作区列出并恢复已有的 `pi` 会话
- 创建新会话，并通过 `pi` 运行时发送提示词
- 保存桌面端界面状态，包括当前工作区、当前会话和输入框草稿
- 使用接近 Codex 的时间线与会话交互方式管理本地编程任务
- **内置 DeepSeek V4 Pro 1M / Flash 1M 模型支持**，一键配置 API Key 即可使用
- **中文 / 日文 UI**，在 Settings → Appearance 切换

## 使用前提

- macOS 桌面环境（Apple Silicon 或 Intel）
- 拥有 DeepSeek API Key（或其他 `pi` 支持的模型服务商）

首次启动后，应用会自动弹出 **设置 > Providers** 引导配置 API Key。

## 本地开发

安装依赖：

```bash
corepack enable
pnpm install
```

启动桌面端开发环境：

```bash
pnpm dev
```

构建全部模块：

```bash
pnpm build
```

运行默认测试：

```bash
pnpm test
```

桌面端 E2E 测试说明见 [`apps/desktop/README.md`](./apps/desktop/README.md)。

## 打包

macOS 双架构打包：

```bash
pnpm --filter @pi-gui/desktop run package
```

Linux AppImage 打包：

```bash
pnpm --filter @pi-gui/desktop run package:linux
```

## 目录结构

- `apps/desktop`：Electron 桌面应用和渲染层界面
- `packages/session-driver`：共享的会话驱动类型
- `packages/catalogs`：轻量级工作区与会话目录状态
- `packages/pi-sdk-driver`：桌面应用与 `@earendil-works/pi-coding-agent` 之间的适配层

## 致谢

- 原始桌面端项目：[`minghinmatthewlam/pi-gui`](https://github.com/minghinmatthewlam/pi-gui)
- 上游运行时与生态：[`earendil-works/pi`](https://github.com/earendil-works/pi)
- 编程智能体包：[`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)

## 许可证

MIT · [Yiding by HKEZ](https://github.com/jasonet) · Copyright 2026
