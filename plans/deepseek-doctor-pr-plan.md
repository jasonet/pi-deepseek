# DeepSeek Doctor & Contract PR Plan

Status: planning. Target: Pi-Deepseek v0.3.x

## PR-1：`packages/deepseek-contract` — 离线单元测试与工具函数

无 UI，纯逻辑层。

- 新增 `packages/deepseek-contract/` 包
- 离线测试（不走网络）：
  - assistant tool call replay 时 `reasoning_content` 不丢失
  - streaming `tool_call` 按 index 聚合
  - 空 `choices` 不 crash
  - cache hit fields 正规化（`usage.cache_read_input_tokens`）
- 暴露工具函数：`normalizeCacheFields()` / `aggregateToolCalls()` / `validateStreamChunk()`
- 测试数据来自 `test/fixtures/deepseek/` JSON snapshots

## PR-2：DeepSeek Doctor IPC + Settings UI

### 后端
- 新增 IPC 通道：`pi-gui:deepseek-doctor-check`
- 主进程调用 DeepSeek API，发送最小化 payload：
  - V4 Pro：1 token + `thinking: { type: "disabled" }`
  - V4 Flash：1 token + `thinking: { type: "disabled" }`
- 检查项：
  - API key 有效
  - V4 Pro / Flash 模型可用
  - thinking off payload 正常返回
  - stream 模式正常
  - cache fields (`usage.cache_read_input_tokens`) 返回

### UI
- Settings → Providers → DeepSeek 详情增加 "Health Check" 按钮
- 结果显示面板：✅/⚠️/❌ 各检查项
- 已有余额查询保留（`getProviderBalance`）

## PR-3：session usage/cost/cache event + timeline 显示

### 后端
- 扩展 `SessionDriverEvent`，新增 `runUsageUpdated` 事件
- `RunCompletedEvent` 携带 `usage: { input, output, cacheHit, cost }`
- pi-sdk-driver 在 stream 完成时计算 usage

### UI
- Timeline 行尾显示：`🔥 1.2K tokens · 💰 ¥0.003 · ⚡ cache hit`
- 完成时显示总 usage/cost 摘要

## PR-4：DeepSeek 错误诊断与用户提示

- 在 `toSessionErrorInfo` / run failed path 增加 DeepSeek 特有错误提示：
  - `reasoning_content must be passed back` → "DeepSeek reasoning 回传错误，切换 thinking off 重试？"
  - `context ceiling` → "上下文超限，请压缩会话"
  - `length finish` + 空 tool call → "模型提前截断，增加 max_tokens"
  - API key / balance → "API key 无效或余额不足，检查 Providers 设置"
- 错误消息中日双语

## PR-5：opt-in live packaged smoke

- 新增 `PI_APP_DEEPSEEK_CONTRACT=1` opt-in 环境变量
- 使用真实 DeepSeek key 跑 1-token doctor 或简短工具回合
- 默认 CI 不跑（成本考虑）
- 挂到 release checklist 手动执行

## PR-6：上游修复（按需）

- 若 PR-1 发现 pi-ai/pi-coding-agent 上游缺口
- 向上游提 PR，不在 GUI 内硬补

---

## 不推荐

| 方案 | 原因 |
|------|------|
| 打包 deepseek-harness Python core 进 Electron | Python/runtime/发版复杂度，与 "thin over pi-mono" 冲突 |
| fork/reimplement OpenAI provider streaming | 上游 pi-ai 已有 DeepSeek compat；协议层问题应 upstream |
| 内置 harness MCP server | 属于外部调试工具，App 内用原生 doctor/telemetry |
