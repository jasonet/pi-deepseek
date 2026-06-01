# pi-deepseek

`pi-deepseek` 是一个面向本地 AI 编程工作流的桌面客户端，为 `pi` 会话提供接近 Codex 的桌面交互体验。

本项目在 [`pi-gui`](https://github.com/minghinmatthewlam/pi-gui) 的基础上持续开发，并通过 `@earendil-works/pi-coding-agent` 接入上游 `pi` 运行时。它不是一个独立的编程智能体运行时：会话管理、模型与认证配置、智能体执行等核心能力仍由上游 `pi` 提供。

![pi-deepseek 演示](./docs/readme/demo.gif)

## 当前状态

- 正在开发中
- 当前以 macOS 桌面端为主要验证环境
- 源码仓库：[`jasonet/pi-deepseek`](https://github.com/jasonet/pi-deepseek)

## 功能

- 在桌面客户端中打开本地工作区
- 按工作区列出并恢复已有的 `pi` 会话
- 创建新会话，并通过 `pi` 运行时发送提示词
- 保存桌面端界面状态，包括当前工作区、当前会话和输入框草稿
- 使用接近 Codex 的时间线与会话交互方式管理本地编程任务

## 使用前提

- 已安装 Node.js 和 `pnpm`
- 拥有 `pi` 支持的有效模型服务认证信息

首次启动后，请在 **设置 > 服务商** 中连接或配置模型服务商。

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

桌面端 E2E 测试说明见 [`apps/desktop/README.md`](./apps/desktop/README.md)。默认桌面测试命令会运行 `core` 测试通道；如需运行 `core`、`live` 和 `native` 全部通道，请执行：

```bash
pnpm --filter @pi-gui/desktop run test:e2e:all
```

## 打包

在本地打包 Linux AppImage：

```bash
pnpm --filter @pi-gui/desktop run package:linux
```

运行接近生产环境的桌面应用检查：

```bash
pnpm --filter @pi-gui/desktop run test:prod:packaged-smoke
```

生成 README 演示素材：

```bash
pnpm --filter @pi-gui/desktop demo:readme
```

## 目录结构

- `apps/desktop`：Electron 桌面应用和渲染层界面
- `packages/session-driver`：共享的会话驱动类型
- `packages/catalogs`：轻量级工作区与会话目录状态
- `packages/pi-sdk-driver`：桌面应用与 `@earendil-works/pi-coding-agent` 之间的适配层

## 已知限制

- 当前仍依赖上游 `pi` 的行为和本地认证状态。
- 需要真实模型调用的端到端验证依赖本地凭据，本仓库不会保存这些凭据。
- 安装包和自动更新渠道仍在准备中。

## 致谢

- 原始桌面端项目：[`minghinmatthewlam/pi-gui`](https://github.com/minghinmatthewlam/pi-gui)
- 上游运行时与生态：[`earendil-works/pi`](https://github.com/earendil-works/pi)
- 编程智能体包：[`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)

## 许可证

本项目采用 MIT 许可证，详见 [`LICENSE`](./LICENSE)。
