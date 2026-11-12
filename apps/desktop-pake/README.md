# Taosi Pake macOS 对比预览版

使用本机 Pake 3.18.0 源码打包当前 Taosi React 界面，通过受限的 Tauri 插件连接 Node sidecar。会话、Pi runtime、终端和本地服务复用现有桌面实现。

此版本用于比较 WebKit 与 Electron，尚未完成所有功能的等价验证。当前只提供 macOS Apple Silicon（arm64）ZIP，应用名为 `Taosi-Pake.app`，可与 Electron 版并存。

## 体积

同为 3.0.21 / arm64；ZIP 使用文件字节数，`.app` 使用 `du -sk` 的磁盘占用，单位为 MiB（1024² 字节）。

| 项目 | Electron | Pake | 减少 |
| --- | ---: | ---: | ---: |
| 应用 `.app` | 362.9 MiB | 249.9 MiB | 113.0 MiB / 31.1% |
| 分发 ZIP | 160.7 MiB | 121.4 MiB | 39.3 MiB / 24.5% |

Pake 使用系统 WKWebView，包内仍保留实际运行所需的 Node、Pi、fx、原生 PTY 和扩展资源。

## 构建

在仓库根目录执行；需要 macOS、Rust、Xcode Command Line Tools、pnpm，以及已安装依赖的本地 [Pake](https://github.com/tw93/Pake) 源码。

```sh
pnpm install
node apps/desktop-tauri/scripts/stage-runtime.mjs
PAKE_SOURCE_DIR=/Users/tfwl/Sites/Github/Pake node apps/desktop-pake/scripts/package-mac.mjs
node --test apps/desktop-pake/tests/sidecar.test.mjs
node scripts/test-manage-release-retention.mjs
```

构建脚本只修改 `build/pake-template` 中的副本，输出到 `release/3.0.21/`，同时生成 `latest-pake-arm64.json` 更新清单。Rust 依赖已缓存时可设置 `CARGO_NET_OFFLINE=true`。

Pake 的打包与 sidecar 验证使用显式 `package:mac` / `test:sidecar` 命令；不会加入仓库通用的递归 build/test，以免要求其他平台或全新检出预先提供 macOS 运行资源。

## 数据与安装

解压后将 `Taosi-Pake.app` 拖入 Applications。应用采用独立标识 `com.pi-deepseek.pake`，应用状态和 Pi 会话位于 `~/Library/Application Support/com.pi-deepseek.pake/`。首次启动会将已有 Pi 的认证、模型及设置文件复制到独立配置目录；不会迁移 Electron 的聊天历史。fx 继续复用系统已有的 fx 登录。

此对比包采用本地 ad hoc 签名，未经过 Apple notarization；下载后的 Gatekeeper 行为尚未验证。

## 2026-11-12 验证记录

已在打包后的 Pake macOS 窗口验证：

- 真实 Pi / DeepSeek V4 Flash 请求收到 `PAKE_LIVE_OK` 回复。
- 原生目录选择、文件附件选择与发送、剪贴板图片粘贴。
- 集成终端实际启动 shell，并显示 `PAKE_UI_TERMINAL_OK`。
- 主界面、模型选择与新会话操作。

自动验证：

- `node --test apps/desktop-pake/tests/sidecar.test.mjs` 通过，覆盖打包 Node 后端、文件预览、真实 PTY、代码执行输出与偏好持久化。
- `node scripts/test-manage-release-retention.mjs` 通过。
- `codesign --verify --deep --strict` 通过。
- 更新检查、真实 ZIP 下载、SHA256、应用标识与版本、签名及暂存就绪通过本地 HTTP feed 验证；没有执行安装或替换应用。
- Electron core lane 运行 99 项，71 项通过、28 项失败，涉及设置、预览和时间线等；尚未完成失败项归因，因此不视为全量回归通过。

已知限制与待验证项：

- 本机 fx 在 ACP 初始化时返回 `Failed to load startup state`；系统 CLI 与包内 CLI 均可独立复现，真实 fx 会话未通过验证。
- OAuth 完整重新登录、通知与系统权限、拖放附件、DSH 各服务完整工作流、更新安装及回滚尚未完成端到端验证。
- Pake 更新使用独立 `latest-pake-arm64.json`，不会安装 Electron 或旧 Tauri 包。更新清单与 ZIP 需一起发布；后续版本也必须提供该清单。

请保留 Electron 版作为当前完整桌面入口。
