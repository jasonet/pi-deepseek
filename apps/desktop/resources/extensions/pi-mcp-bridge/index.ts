/**
 * pi-mcp-bridge
 *
 * Gives pi a generic MCP client "entry point": it reads mcp.json, connects to
 * each configured MCP server (stdio or streamable-http), discovers their tools,
 * and registers every remote tool as a native pi tool named `<server>__<tool>`.
 *
 * This is how Unity MCP (CoplayDev) and Higgsfield MCP plug into pi / Pi-Deepseek,
 * since pi has no built-in MCP support — the bridge IS the MCP support.
 *
 * Commands:
 *   /mcp                  Show connection + tool status, reconnect.
 *   /concept-to-scene ... Run the concept -> scene closed-loop workflow.
 */
import { homedir } from "node:os";
import { join, delimiter } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

interface ServerConfig {
  enabled?: boolean;
  transport: "stdio" | "http";
  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // http
  url?: string;
  headers?: Record<string, string>;
}

interface BridgeConfig {
  connectTimeoutMs?: number;
  servers: Record<string, ServerConfig>;
}

interface ServerState {
  name: string;
  status: "connected" | "error" | "disabled";
  toolCount: number;
  error?: string;
  client?: Client;
}

const CONFIG_PATH =
  process.env.PI_MCP_BRIDGE_CONFIG ||
  join(homedir(), ".pi", "agent", "extensions", "pi-mcp-bridge", "mcp.json");

/** Replace ${VAR} with process.env.VAR (empty string if unset). */
function expandEnv<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_m, k) => process.env[k] ?? "") as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v) => expandEnv(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = expandEnv(v);
    return out as T;
  }
  return value;
}

function sanitizeToolName(server: string, tool: string): string {
  return `${server}__${tool}`.replace(/[^A-Za-z0-9_]/g, "_");
}

/**
 * Ensure common tool dirs (Homebrew, uv/pipx, cargo) are on PATH for stdio
 * child processes. A GUI-launched host (e.g. the Pi-Deepseek app) can inherit
 * a stripped PATH where `uvx` is missing; without this the Unity MCP server
 * fails to spawn with ENOENT.
 */
function augmentPath(current: string | undefined): string {
  const merged = new Set((current ?? "").split(delimiter).filter(Boolean));
  const home = homedir();
  for (const dir of [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    `${home}/.local/bin`,
    `${home}/.cargo/bin`,
    `${home}/.bun/bin`,
    "/usr/bin",
    "/bin",
  ]) {
    if (existsSync(dir)) merged.add(dir);
  }
  return [...merged].join(delimiter);
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

/** Map an MCP tool-call result into a pi tool result. */
function mapResult(res: any): { content: any[]; details: any; isError?: boolean } {
  const content: any[] = [];
  for (const item of res?.content ?? []) {
    if (item?.type === "text") {
      content.push({ type: "text", text: String(item.text ?? "") });
    } else if (item?.type === "image" && item.data) {
      content.push({
        type: "image",
        source: { type: "base64", mediaType: item.mimeType ?? "image/png", data: item.data },
      });
    } else {
      content.push({ type: "text", text: JSON.stringify(item) });
    }
  }
  if (content.length === 0) content.push({ type: "text", text: res?.isError ? "(error, no content)" : "(no content)" });
  return { content, details: { raw: res }, isError: Boolean(res?.isError) };
}

export default async function (pi: ExtensionAPI) {
  const states = new Map<string, ServerState>();

  function loadConfig(): BridgeConfig {
    const raw = readFileSync(CONFIG_PATH, "utf8");
    return JSON.parse(raw) as BridgeConfig;
  }

  async function connectServer(name: string, cfgRaw: ServerConfig, timeoutMs: number): Promise<void> {
    const cfg = expandEnv(cfgRaw);
    const client = new Client({ name: "pi-mcp-bridge", version: "0.1.0" });

    let transport;
    if (cfg.transport === "stdio") {
      if (!cfg.command) throw new Error(`server "${name}": stdio requires "command"`);
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
      for (const [k, v] of Object.entries(cfg.env ?? {})) env[k] = v;
      env.PATH = augmentPath(env.PATH);
      transport = new StdioClientTransport({ command: cfg.command, args: cfg.args ?? [], env });
    } else if (cfg.transport === "http") {
      if (!cfg.url) throw new Error(`server "${name}": http requires "url"`);
      const headers = cfg.headers ?? {};
      transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
        requestInit: { headers },
      });
    } else {
      throw new Error(`server "${name}": unknown transport "${(cfg as any).transport}"`);
    }

    await withTimeout(client.connect(transport), timeoutMs, `connect("${name}")`);
    const tools = (await withTimeout(client.listTools(), timeoutMs, `listTools("${name}")`)).tools ?? [];

    for (const tool of tools) {
      const piName = sanitizeToolName(name, tool.name);
      pi.registerTool({
        name: piName,
        label: `${name}: ${tool.name}`,
        description: tool.description ?? `MCP tool ${tool.name} from server ${name}`,
        promptSnippet: tool.description?.split("\n")[0]?.slice(0, 120),
        parameters: Type.Unsafe<Record<string, unknown>>(tool.inputSchema ?? { type: "object" }),
        async execute(_id, params) {
          const res = await client.callTool({ name: tool.name, arguments: params ?? {} });
          return mapResult(res);
        },
      });
    }

    states.set(name, { name, status: "connected", toolCount: tools.length, client });
  }

  async function connectAll(notify?: (msg: string, level: "info" | "warn" | "error") => void) {
    let cfg: BridgeConfig;
    try {
      cfg = loadConfig();
    } catch (e) {
      notify?.(`pi-mcp-bridge: cannot read ${CONFIG_PATH}: ${(e as Error).message}`, "error");
      return;
    }
    const timeoutMs = cfg.connectTimeoutMs ?? 15000;

    // Close any existing clients before reconnecting.
    for (const s of states.values()) {
      try {
        await s.client?.close();
      } catch {
        /* ignore */
      }
    }
    states.clear();

    for (const [name, serverCfg] of Object.entries(cfg.servers ?? {})) {
      if (serverCfg.enabled === false) {
        states.set(name, { name, status: "disabled", toolCount: 0 });
        continue;
      }
      try {
        await connectServer(name, serverCfg, timeoutMs);
        notify?.(`pi-mcp-bridge: "${name}" connected (${states.get(name)?.toolCount} tools)`, "info");
      } catch (e) {
        states.set(name, { name, status: "error", toolCount: 0, error: (e as Error).message });
        notify?.(`pi-mcp-bridge: "${name}" failed: ${(e as Error).message}`, "warn");
      }
    }
  }

  function statusText(): string {
    const lines: string[] = ["MCP bridge status:"];
    for (const s of states.values()) {
      const tail =
        s.status === "connected"
          ? `${s.toolCount} tools`
          : s.status === "disabled"
            ? "disabled"
            : `error: ${s.error}`;
      lines.push(`  • ${s.name}: ${s.status} (${tail})`);
    }
    if (states.size === 0) lines.push("  (no servers configured)");
    return lines.join("\n");
  }

  let lastUi: { setStatus: (key: string, value: string) => void } | undefined;
  function publishStatus() {
    const connected = [...states.values()].filter((s) => s.status === "connected");
    if (lastUi && connected.length > 0) {
      lastUi.setStatus("mcp-bridge", `MCP: ${connected.map((s) => s.name).join(", ")}`);
    }
  }

  // Connect in the background so a slow MCP server (e.g. first-run `uvx`
  // download for Unity) never blocks extension load / app startup. Each tool
  // registers as its server connects; the status line updates when done.
  void connectAll().then(publishStatus).catch(() => {});

  pi.on("session_start", async (_e, ctx) => {
    lastUi = ctx.ui;
    publishStatus();
  });

  pi.on("session_shutdown", async () => {
    for (const s of states.values()) {
      try {
        await s.client?.close();
      } catch {
        /* ignore */
      }
    }
  });

  pi.registerCommand("mcp", {
    description: "Show MCP bridge status and reconnect servers",
    handler: async (args, ctx) => {
      if (args.trim() === "reconnect") {
        ctx.ui.notify("Reconnecting MCP servers...", "info");
        await connectAll((m, l) => ctx.ui.notify(m, l === "warn" ? "warn" : l));
      }
      ctx.ui.notify(statusText(), "info");
    },
    getArgumentCompletions: (prefix: string) => {
      const items = [{ value: "reconnect", label: "reconnect — close & reconnect all servers" }];
      const filtered = items.filter((i) => i.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
  });

  pi.registerCommand("concept-to-scene", {
    description: "Concept -> Scene closed loop: Higgsfield generates art, Unity places it, capture & iterate",
    handler: async (args, ctx) => {
      const concept = args.trim();
      if (!concept) {
        ctx.ui.notify(
          'Usage: /concept-to-scene <concept>. Example: /concept-to-scene 黄昏沙漠绿洲，低多边形风格的天空盒与地表贴图',
          "warn",
        );
        return;
      }
      pi.sendUserMessage(buildConceptToScenePrompt(concept));
    },
  });
}

function buildConceptToScenePrompt(concept: string): string {
  return `# 任务：概念 → 场景 闭环（Higgsfield + Unity）

目标概念：**${concept}**

你现在可以使用通过 pi-mcp-bridge 桥接进来的两组工具：
- Higgsfield 工具，名字形如 \`higgsfield__*\`（生成 2D 图像 / 贴图 / 视频；异步，按 credit 计费）。
- Unity 工具，名字形如 \`unity__*\`（操作 Unity 编辑器：生成/导入资产、建场景、相机截图等）。

请严格按下面的闭环执行，每一步先说明你要调哪个工具、为什么：

1. **出概念图**：用某个 \`higgsfield__*\` 图像生成工具，根据「${concept}」生成 1 张概念图/贴图。把返回的图片或下载链接保存到当前 Unity 工程的 \`Assets/Generated/\` 下（用 bash 下载，文件名带语义，如 \`oasis_skybox_v1.png\`）。
2. **入引擎**：用 \`unity__*\` 工具把该资产导入并应用到场景（贴到材质 / 设为天空盒 / 铺到地表，取决于资产类型）。
3. **看效果**：用 \`unity__*\` 的场景截图工具（如 SceneView/Camera capture）截一张当前场景图。
4. **评估**：查看截图，对照「${concept}」判断是否达标。说明差距（色调、构图、风格、分辨率等）。
5. **迭代**：若不达标，调整 Higgsfield 的 prompt/参数重生成（命名 \`*_v2\`、\`*_v3\`……），回到第 2 步；最多迭代 3 轮。
6. **收尾**：达标后输出小结：用了哪些资产、放在哪些 GameObject/材质上、最终截图、剩余可改进点。

约束：
- Higgsfield 产的是 2D 图/视频，不是 3D 网格；3D 网格请用 \`unity__*\` 的资产生成工具或提示我用别的工具。
- 视频/大图生成是异步的，发起后耐心轮询其状态工具，别空转。
- 每生成一个资产都要真正落盘到工程 \`Assets/\` 并触发 Unity 导入，确保闭环可见。

现在开始第 1 步。`;
}
