# Claw IM 消息工作流 & Agent 进度显示

## 1. 数据存储：确认轻量 JSON 方案

采用与 Kun 一致的 JSON 文件存储，无需数据库：

```
~/.pi/agent/
├── im/
│   ├── channels.json          ← IM 通道配置（已连接列表）
│   ├── messages/
│   │   ├── weixin/
│   │   │   └── {channelId}.jsonl   ← 消息流（append-only JSONL）
│   │   └── feishu/
│   │       └── {channelId}.jsonl
│   └── sessions/
│       └── {imMsgId}.json      ← 每条 IM 消息对应一个 pi session 快照
```

**为什么不用 SQLite/MongoDB：**
- Electron asar 读写复杂
- 与 pi 生态的 JSON 风格一致
- 消息量级小（IM 不是高频场景）
- JSONL append-only 写入安全，不丢数据

---

## 2. IM 消息到达 → Agent 回复 工作流

```
┌─────────────────────────────────────────────────────────────┐
│ IM Platform (WeChat/Feishu)                                 │
│   Webhook → POST http://127.0.0.1:8788/im/webhook          │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Pi-Deepseek IM Bridge (app-store)                       │
│    - 解析 webhook payload                                   │
│    - 写入 im/messages/{provider}/{channelId}.jsonl          │
│    - 匹配 ImChannel（按 provider + channelId）               │
│    - 创建/恢复 pi session                                   │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Pi Agent Runtime (pi-sdk-driver)                        │
│    - session.prompt(userMessage)                            │
│    - 流式输出 reasoning + tool calls + assistant reply      │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Agent Response → IM Reply                                │
│    - 提取最终 assistant message text                        │
│    - 通过 IM SDK / webhook reply 发送回复                    │
│    - 写入 im/messages/{provider}/{channelId}.jsonl          │
└─────────────────────────────────────────────────────────────┘
```

### 待测试清单

| 步骤 | 测试点 | 状态 |
|------|--------|------|
| Webhook 接收 | `POST /im/webhook` 到达 ImBridge | ⬜ |
| 消息持久化 | JSONL append 无丢数据 | ⬜ |
| 通道匹配 | 按 provider+channelId 找到 ImChannel | ⬜ |
| Session 创建 | 新消息 → 自动创建 pi session | ⬜ |
| Session 恢复 | 已有 session → prompt 追加到对话 | ⬜ |
| Agent 回复 | assistant message → IM reply | ⬜ |
| 错误处理 | IM API 失败 → 重试/降级 | ⬜ |

---

## 3. Agent 进度显示（减少等待焦虑）

### 方案：Timeline 实时流式卡片

当用户发送 IM 消息后，在 Timeline 显示一个实时更新的流式卡片：

```
┌──────────────────────────────────────────┐
│ 🧠 正在思考...                           │  ← 推理阶段
│ "分析用户意图：需要生成登录页设计..."     │
│                                          │
│ 📊 23 t/s · 推理: high                   │  ← 速度 + thinking level
│                                          │
│ 🛠 调用工具: project create               │  ← tool call 阶段
│   参数: { name: "login-page" }            │
│                                          │
│ 💬 正在生成回复...                        │  ← 最终回复
│ "好的，我来为你生成一个登录页..."         │
└──────────────────────────────────────────┘
```

### 实现要点

| 元素 | 数据来源 | 说明 |
|------|---------|------|
| 推理标题 | `assistant_delta.reasoning_content` 第一句 | 自动提取，如 "分析用户意图：..." |
| tokens/s | `session.runStats.tokensPerSecond` | 从 stream 实时计算 |
| thinking level | session config | "推理: high" / "推理: off" |
| tool call | `tool_call.name + arguments` | 流式展开 |
| 最终回复 | `assistant_delta.content` | 流式追加 |

### 实现层级

```
connect-phone-view.tsx (现有)       ← IM 通道管理 UI
settings-channels-section.tsx (现有) ← IM 通道设置
---
待新增:
im-message-bridge.ts (main process)  ← Webhook 接收 + JSONL 存储
im-session-manager.ts (main process) ← IM 消息 → pi session 映射
timeline-stream-card.tsx (renderer)  ← 流式进度卡片
```

### 最小可行方案（本周可完成）

1. 复用现有 `session-supervisor` 的 `sendUserMessage` + 事件订阅
2. 在 Timeline 中已有 `ConversationTimeline`，直接利用现有 streaming 渲染
3. 新增 `im-message-bridge.ts` 处理 webhook 接收
4. 不在 UI 层新增进度组件，先用现有 streaming timeline 展示

**优势**：零 UI 改动，现有 streaming timeline 已支持实时显示 token、tool calls、reasoning。
