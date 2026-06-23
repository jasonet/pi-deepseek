/**
 * pi-mcp-higgsfield
 *
 * Bridges the Higgsfield MCP server into pi as native tools. It reads its own
 * mcp.json, connects to Higgsfield over streamable HTTP, discovers their tools,
 * and registers every remote tool as a native pi tool named `<server>__<tool>`
 * (e.g. `higgsfield__*`) for AI image / video generation.
 *
 * Requirements:
 *   - HIGGSFIELD_TOKEN in the environment (sent as `Authorization: Bearer`).
 *
 * Commands:
 *   /higgsfield   Show connection + tool status, `reconnect` to retry.
 */
import { homedir } from "node:os";
import { join, delimiter } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const EXT_ID = "pi-mcp-higgsfield";
const STATUS_KEY = "mcp-higgsfield";
const STATUS_LABEL = "Higgsfield MCP";

interface ServerConfig {
  enabled?: boolean;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

interface McpConfig {
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
  process.env.PI_MCP_HIGGSFIELD_CONFIG ||
  join(homedir(), ".pi", "agent", "extensions", EXT_ID, "mcp.json");

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

/** Ensure common tool dirs are on PATH for any stdio child processes. */
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

  function loadConfig(): McpConfig {
    const raw = readFileSync(CONFIG_PATH, "utf8");
    return JSON.parse(raw) as McpConfig;
  }

  async function connectServer(name: string, cfgRaw: ServerConfig, timeoutMs: number): Promise<void> {
    const cfg = expandEnv(cfgRaw);
    const client = new Client({ name: EXT_ID, version: "0.1.0" });

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
      transport = new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers } });
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
    let cfg: McpConfig;
    try {
      cfg = loadConfig();
    } catch (e) {
      notify?.(`${EXT_ID}: cannot read ${CONFIG_PATH}: ${(e as Error).message}`, "error");
      return;
    }
    const timeoutMs = cfg.connectTimeoutMs ?? 15000;

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
        notify?.(`${EXT_ID}: "${name}" connected (${states.get(name)?.toolCount} tools)`, "info");
      } catch (e) {
        states.set(name, { name, status: "error", toolCount: 0, error: (e as Error).message });
        notify?.(`${EXT_ID}: "${name}" failed: ${(e as Error).message}`, "warn");
      }
    }
  }

  function statusText(): string {
    const lines: string[] = [`${STATUS_LABEL} status:`];
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
      lastUi.setStatus(STATUS_KEY, `${STATUS_LABEL}: ${connected.map((s) => s.name).join(", ")}`);
    }
  }

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

  pi.registerCommand("higgsfield", {
    description: "Show Higgsfield MCP status and reconnect (needs HIGGSFIELD_TOKEN)",
    handler: async (args, ctx) => {
      if (args.trim() === "reconnect") {
        ctx.ui.notify("Reconnecting Higgsfield MCP...", "info");
        await connectAll((m, l) => ctx.ui.notify(m, l === "warn" ? "warn" : l));
      }
      if (!process.env.HIGGSFIELD_TOKEN) {
        ctx.ui.notify("HIGGSFIELD_TOKEN is not set — Higgsfield MCP cannot authenticate.", "warn");
      }
      ctx.ui.notify(statusText(), "info");
    },
    getArgumentCompletions: (prefix: string) => {
      const items = [{ value: "reconnect", label: "reconnect — close & reconnect Higgsfield MCP" }];
      const filtered = items.filter((i) => i.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
  });
}
