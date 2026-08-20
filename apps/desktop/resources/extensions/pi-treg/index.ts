import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

interface Policy {
  readonly enabled: boolean;
  readonly piEnabled: boolean;
  readonly serviceUrl: string;
  readonly paidCalls: "disabled" | "ask";
  readonly allowMutatingCalls: boolean;
  readonly workspaceRoots: readonly string[];
}

interface Credential {
  readonly token: string;
  readonly source: "env" | "config";
  readonly baseUrl?: string;
}

const DEFAULT_POLICY: Policy = {
  enabled: false,
  piEnabled: true,
  serviceUrl: "https://treg.to/mcp/",
  paidCalls: "ask",
  allowMutatingCalls: false,
  workspaceRoots: [],
};
const MCP_TIMEOUT_MS = 8_000;

function policyPath(): string {
  const configured = process.env.PI_TREG_POLICY_PATH?.trim();
  if (configured) return resolveUserPath(configured);
  const agentDir = process.env.PI_CODING_AGENT_DIR?.trim();
  return agentDir
    ? path.join(resolveUserPath(agentDir), "treg.json")
    : path.join(homedir(), ".pi", "agent", "treg.json");
}

function tregConfigPath(): string {
  const configured = process.env.TREG_CONFIG?.trim();
  return configured ? resolveUserPath(configured) : path.join(homedir(), ".treg", "config.json");
}

function resolveUserPath(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return path.join(homedir(), value.slice(2));
  return path.resolve(value);
}

function readPolicy(): Policy {
  try {
    const value = JSON.parse(readFileSync(policyPath(), "utf8")) as Partial<Policy>;
    return {
      enabled: value.enabled === true,
      piEnabled: value.piEnabled !== false,
      serviceUrl: typeof value.serviceUrl === "string" ? value.serviceUrl : DEFAULT_POLICY.serviceUrl,
      paidCalls: value.paidCalls === "disabled" ? "disabled" : "ask",
      allowMutatingCalls: value.allowMutatingCalls === true,
      workspaceRoots: Array.isArray(value.workspaceRoots)
        ? value.workspaceRoots.filter((root): root is string => typeof root === "string")
        : [],
    };
  } catch {
    return DEFAULT_POLICY;
  }
}

function readCredential(): Credential | undefined {
  const envToken = process.env.TREG_TOKEN?.trim();
  if (envToken) return { token: envToken, source: "env" };
  try {
    const value = JSON.parse(readFileSync(tregConfigPath(), "utf8")) as { token?: unknown; base_url?: unknown };
    return typeof value.token === "string" && value.token.trim()
      ? {
          token: value.token.trim(),
          source: "config",
          baseUrl: typeof value.base_url === "string" && value.base_url.trim() ? value.base_url.trim() : undefined,
        }
      : undefined;
  } catch {
    return undefined;
  }
}

function credentialMatchesService(credential: Credential, serviceUrl: string): boolean {
  if (!credential.baseUrl) return true;
  try {
    return new URL(credential.baseUrl).origin === new URL(serviceUrl).origin;
  } catch {
    return false;
  }
}

export function isWorkspaceAllowed(cwd: string, roots: readonly string[]): boolean {
  const resolved = path.resolve(cwd);
  return roots.some((root) => {
    const allowed = path.resolve(root);
    return resolved === allowed || resolved.startsWith(`${allowed}${path.sep}`);
  });
}

function policyError(ctx: ExtensionContext, policy: Policy): string | undefined {
  if (!policy.enabled || !policy.piEnabled) return "Treg is disabled for Pi in Settings > External tools.";
  if (!isWorkspaceAllowed(ctx.cwd, policy.workspaceRoots)) return `Treg is not authorized for this workspace (${ctx.cwd}).`;
  return undefined;
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], details: { error: message }, isError: true };
}

function mapResult(result: any) {
  const content = (result?.content ?? []).map((item: any) => {
    if (item?.type === "text") return { type: "text", text: String(item.text ?? "") };
    if (item?.type === "image" && item.data) {
      return {
        type: "image",
        source: { type: "base64", mediaType: item.mimeType ?? "image/png", data: item.data },
      };
    }
    return { type: "text", text: JSON.stringify(item) };
  });
  if (content.length === 0 && result?.structuredContent) content.push({ type: "text", text: JSON.stringify(result.structuredContent, null, 2) });
  if (content.length === 0) content.push({ type: "text", text: "(no content)" });
  return { content, details: { structuredContent: result?.structuredContent }, isError: Boolean(result?.isError) };
}

export function redact(value: unknown, key = ""): unknown {
  if (/token|secret|password|authorization|api[-_]?key|cookie/i.test(key)) return "<redacted>";
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redact(entryValue, entryKey)]));
  }
  return value;
}

function resultObject(result: any): Record<string, unknown> | undefined {
  const candidates: unknown[] = [result?.structuredContent];
  for (const item of result?.content ?? []) {
    if (item?.type !== "text") continue;
    try { candidates.push(JSON.parse(item.text)); } catch { /* plain text */ }
  }
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate as Record<string, unknown>;
    }
  }
  return undefined;
}

export function catalogContractFromResult(result: any): { method: string; price: string } {
  const value = resultObject(result);
  if (typeof value?.error === "string") throw new Error(value.error);
  const endpoint = value?.endpoint;
  if (!endpoint || typeof endpoint !== "object" || Array.isArray(endpoint)) {
    throw new Error("Treg did not return a catalog endpoint contract; the call was not executed.");
  }
  const methodValue = (endpoint as Record<string, unknown>).method;
  const method = typeof methodValue === "string" ? methodValue.trim().toUpperCase() : "";
  if (!method) throw new Error("Treg did not publish this endpoint's HTTP method; the call was not executed.");
  const cost = (endpoint as Record<string, unknown>).cost;
  if (!cost || typeof cost !== "object" || Array.isArray(cost)) {
    throw new Error("Treg did not publish this endpoint's price; the call was not executed.");
  }
  const costRecord = cost as Record<string, unknown>;
  if (typeof costRecord.usd === "number") return { method, price: `$${costRecord.usd.toFixed(6)} per call` };
  if (typeof costRecord.value === "number" && typeof costRecord.currency === "string") {
    return { method, price: `${costRecord.value} ${costRecord.currency} per call` };
  }
  throw new Error("Treg did not publish this endpoint's price; the call was not executed.");
}

export default async function tregExtension(pi: ExtensionAPI) {
  const initialPolicy = readPolicy();
  if (!initialPolicy.enabled || !initialPolicy.piEnabled || !readCredential()) return;
  const clients = new Map<string, Promise<Client>>();

  async function getClient(policy: Policy, credential: Credential): Promise<Client> {
    const fingerprint = `${policy.serviceUrl}\0${credential.token}`;
    const existing = clients.get(fingerprint);
    if (existing) return existing;
    const pending = (async () => {
      const next = new Client({ name: "pi-deepseek-treg", version: "0.1.1" });
      const transport = new StreamableHTTPClientTransport(new URL(policy.serviceUrl), {
        requestInit: { headers: { Authorization: `Bearer ${credential.token}` } },
      });
      try {
        await next.connect(transport, { timeout: MCP_TIMEOUT_MS });
        return next;
      } catch (error) {
        await next.close().catch(() => undefined);
        throw error;
      }
    })();
    clients.set(fingerprint, pending);
    void pending.catch(() => {
      if (clients.get(fingerprint) === pending) clients.delete(fingerprint);
    });
    return pending;
  }

  async function callReadTool(name: string, params: Record<string, unknown>, ctx: ExtensionContext) {
    const policy = readPolicy();
    const blocked = policyError(ctx, policy);
    if (blocked) return errorResult(blocked);
    const credential = readCredential();
    if (!credential) return errorResult("No Treg login found. Sign in with Treg, then reopen the session.");
    if (!credentialMatchesService(credential, policy.serviceUrl)) return errorResult("The detected Treg login belongs to a different service URL.");
    try {
      const remote = await getClient(policy, credential);
      return mapResult(await remote.callTool({ name, arguments: params }, undefined, { signal: ctx.signal }));
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : "Treg request failed.");
    }
  }

  pi.registerTool({
    name: "treg_catalog_search",
    label: "Treg catalog search",
    description: "Find external data/API endpoints by the job to be done. This is read-only and does not spend call credit.",
    promptSnippet: "Search Treg's external tool catalog before choosing an endpoint.",
    parameters: Type.Object({ query: Type.String(), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })) }),
    execute: (_id, params, _signal, _update, ctx) => callReadTool("catalog_search", params, ctx),
  });
  pi.registerTool({
    name: "treg_catalog_get",
    label: "Treg endpoint details",
    description: "Read one catalog endpoint's parameters, reliability and current price. This does not execute the endpoint.",
    promptSnippet: "Inspect an endpoint and its exact price before any Treg call.",
    parameters: Type.Object({ endpoint_id: Type.String() }),
    execute: (_id, params, _signal, _update, ctx) => callReadTool("catalog_get", params, ctx),
  });
  pi.registerTool({
    name: "treg_balance",
    label: "Treg balance",
    description: "Read the current team's Treg prepaid balance and in-flight holds.",
    parameters: Type.Object({}),
    execute: (_id, params, _signal, _update, ctx) => callReadTool("balance", params, ctx),
  });
  pi.registerTool({
    name: "treg_my_tools",
    label: "Treg team tools",
    description: "List tools registered by the current Treg team. Listing is read-only.",
    parameters: Type.Object({}),
    execute: (_id, params, _signal, _update, ctx) => callReadTool("my_tools", params, ctx),
  });
  pi.registerTool({
    name: "treg_call",
    label: "Treg external call",
    description: "Execute one Treg catalog or team endpoint. Every call requires interactive confirmation because it may spend credit or change an external system.",
    executionMode: "sequential",
    parameters: Type.Object({
      endpoint_id: Type.String(),
      params: Type.Optional(Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Array(Type.Unknown())])),
      method: Type.Optional(Type.String()),
      idempotency_key: Type.Optional(Type.String()),
      query: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      body: Type.Optional(Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Array(Type.Unknown()), Type.String()])),
      headers: Type.Optional(Type.Record(Type.String(), Type.String())),
      content_type: Type.Optional(Type.String()),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const policy = readPolicy();
      const blocked = policyError(ctx, policy);
      if (blocked) return errorResult(blocked);
      if (policy.paidCalls === "disabled") return errorResult("Treg calls are disabled by policy.");
      if (!ctx.hasUI) return errorResult("Treg calls require an interactive Pi confirmation and are refused in headless/IM sessions.");
      const credential = readCredential();
      if (!credential) return errorResult("No Treg login found. Sign in with Treg, then reopen the session.");
      if (!credentialMatchesService(credential, policy.serviceUrl)) return errorResult("The detected Treg login belongs to a different service URL.");
      try {
        let remote: Client | undefined;
        let method: string;
        let price: string;
        if (!params.endpoint_id.includes("/")) {
          remote = await getClient(policy, credential);
          const details = await remote.callTool(
            { name: "catalog_get", arguments: { endpoint_id: params.endpoint_id } },
            undefined,
            { signal: ctx.signal, timeout: MCP_TIMEOUT_MS },
          );
          const contract = catalogContractFromResult(details);
          method = contract.method;
          price = contract.price;
          if (params.method && params.method.toUpperCase() !== method) {
            return errorResult(`Treg catalog declares ${method} for this endpoint; the conflicting ${params.method.toUpperCase()} call was not executed.`);
          }
        } else {
          method = (params.method ?? (params.body !== undefined ? "POST" : "GET")).toUpperCase();
          price = "no Treg credit (team-managed endpoint)";
        }
        const mutating = !["GET", "HEAD"].includes(method) || params.body !== undefined;
        if (mutating && !policy.allowMutatingCalls) return errorResult(`Treg ${method} calls are blocked. Enable external writes in Settings to allow them.`);
        const preview = JSON.stringify(redact({ ...params, method }), null, 2).slice(0, 2_500);
        const confirmed = await ctx.ui.confirm(
          "Confirm Treg external call",
          `Endpoint: ${params.endpoint_id}\nMethod: ${method}\nEstimated cost: ${price}\n\nThis sends data to an external provider and may spend Treg credit.${mutating ? " It may also change external data." : ""}\n\n${preview}`,
        );
        if (!confirmed) return errorResult("Treg call cancelled before any paid endpoint was executed.");
        remote ??= await getClient(policy, credential);
        return mapResult(await remote.callTool(
          { name: "call", arguments: { ...params, method } },
          undefined,
          { signal: ctx.signal },
        ));
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Treg call failed.");
      }
    },
  });

  pi.registerCommand("treg", {
    description: "Show Treg policy and login status",
    handler: async (_args, ctx) => {
      const policy = readPolicy();
      const credential = readCredential();
      const allowed = isWorkspaceAllowed(ctx.cwd, policy.workspaceRoots);
      ctx.ui.notify(
        `Treg: ${policy.enabled && policy.piEnabled ? "enabled" : "disabled"}; login ${credential ? "found" : "missing"}; workspace ${allowed ? "authorized" : "not authorized"}.`,
        policy.enabled && credential && allowed ? "info" : "warn",
      );
    },
  });

  pi.on("session_shutdown", async () => {
    const settled = await Promise.allSettled(clients.values());
    clients.clear();
    await Promise.all(settled
      .filter((result): result is PromiseFulfilledResult<Client> => result.status === "fulfilled")
      .map((result) => result.value.close().catch(() => undefined)));
  });
}
