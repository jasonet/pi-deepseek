import { randomUUID } from "node:crypto";
import type {
  ConnectPhoneQrPollResult,
  ConnectPhoneQrStartResult,
} from "../src/desktop-state";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const FEISHU_BASE_URL = "https://accounts.feishu.cn";
const LARK_BASE_URL = "https://accounts.larksuite.com";
const DEFAULT_WEIXIN_BRIDGE_RPC_URL = "http://127.0.0.1:18790/api/v1/admin/rpc";
const DEFAULT_IM_WEBHOOK_PORT = 8789;
const DEFAULT_IM_WEBHOOK_PATH = "/im/webhook";
const PI_WEIXIN_CHANNEL_ID = "pi-deepseek-weixin";
const weixinLoginSessions = new Map<string, string>();
const feishuDomains = new Map<string, "feishu" | "lark">();

export async function startFeishuInstallQrcode(fetcher: FetchLike, isLark: boolean): Promise<ConnectPhoneQrStartResult> {
  const domain = isLark ? "lark" : "feishu";
  const endpoint = `${isLark ? LARK_BASE_URL : FEISHU_BASE_URL}/oauth/v1/app/registration`;

  // Init — get nonce
  const initPayload = await postFeishuForm(fetcher, endpoint, { action: "init" });
  const nonce = readString(initPayload, "nonce");
  const initError = readString(initPayload, "error");
  if (initError) {
    return { ok: false, message: `飞书初始化失败: ${readString(initPayload, "error_description") ?? initError}` };
  }

  // Begin — use nonce from init
  const beginForm: Record<string, string> = {
    action: "begin",
    archetype: "PersonalAgent",
    auth_method: "client_secret",
    request_user_info: "open_id",
  };
  if (nonce) beginForm.nonce = nonce;

  const payload = await postFeishuForm(fetcher, endpoint, beginForm);
  const beginError = readString(payload, "error");
  if (beginError) {
    return { ok: false, message: `飞书注册失败: ${readString(payload, "error_description") ?? beginError}` };
  }

  const url = readString(payload, "verification_uri_complete");
  const deviceCode = readString(payload, "device_code");
  if (!url || !deviceCode) {
    return { ok: false, message: "飞书没有返回二维码登录地址。" };
  }

  feishuDomains.set(deviceCode, domain);
  return {
    ok: true,
    url,
    deviceCode,
    userCode: readString(payload, "user_code") ?? "",
    interval: readNumber(payload, "interval") ?? 3,
    expireIn: readNumber(payload, "expires_in") ?? 300,
  };
}

export async function pollFeishuInstall(fetcher: FetchLike, deviceCode: string): Promise<ConnectPhoneQrPollResult> {
  const domain = feishuDomains.get(deviceCode) ?? "feishu";
  const endpoint = `${domain === "lark" ? LARK_BASE_URL : FEISHU_BASE_URL}/oauth/v1/app/registration`;
  const payload = await postFeishuForm(fetcher, endpoint, { action: "poll", device_code: deviceCode });

  const error = readString(payload, "error");
  if (error === "authorization_pending" || error === "slow_down") {
    return { done: false };
  }
  if (error) {
    return { done: false, message: readString(payload, "error_description") ?? error };
  }

  const appId = readString(payload, "client_id");
  const appSecret = readString(payload, "client_secret");
  if (!appId || !appSecret) {
    return { done: false };
  }

  feishuDomains.delete(deviceCode);
  return {
    done: true,
    provider: "feishu",
    credential: { kind: "feishu", appId, appSecret, domain: readFeishuDomain(payload, domain) },
  };
}

export async function startWeixinInstallQrcode(fetcher: FetchLike): Promise<ConnectPhoneQrStartResult> {
  const instanceId = randomUUID();
  const payload = await requestWeixinBridge(fetcher, "web.login.start", {
    force: true,
    timeoutMs: 300_000,
    verbose: true,
    source: "pi-deepseek",
    instanceId,
  });
  const url = readFirstString(payload, ["qrDataUrl", "qrUrl", "qrcode", "qrCode", "url"]);
  const sessionKey = readFirstString(payload, ["sessionKey", "accountId", "loginId"]);
  if (!url || !sessionKey) {
    return {
      ok: false,
      message: "微信 bridge 没有返回二维码。请确认 OpenClaw bridge 正在本机运行。",
    };
  }

  const deviceCode = randomUUID();
  weixinLoginSessions.set(deviceCode, sessionKey);
  return {
    ok: true,
    url,
    deviceCode,
    userCode: "",
    interval: 3,
    expireIn: 120,
    instanceId,
  };
}

export async function pollWeixinInstall(fetcher: FetchLike, deviceCode: string): Promise<ConnectPhoneQrPollResult> {
  const sessionKey = weixinLoginSessions.get(deviceCode);
  if (!sessionKey) {
    return { done: false, message: "微信登录会话已过期，请重新生成二维码。" };
  }

  try {
    const waitPayload = await requestWeixinBridge(fetcher, "web.login.wait", {
      timeoutMs: 480_000,
      accountId: sessionKey,
    });
    const connected = readBoolean(waitPayload, "connected") || readString(waitPayload, "message") === "alreadyConnected";
    if (!connected && !readFirstString(waitPayload, ["accountId", "sessionKey"])) {
      return { done: false };
    }

    const accountId = readFirstString(waitPayload, ["accountId", "sessionKey"]) ?? sessionKey;
    await requestWeixinBridge(fetcher, "channels.start", {
      channel: "openclaw-weixin",
      accountId,
      source: "pi-deepseek",
      webhookUrl: resolveImWebhookUrl(),
      webhookSecret: process.env.IM_WEBHOOK_SECRET?.trim() || "",
      channelId: PI_WEIXIN_CHANNEL_ID,
    });
    weixinLoginSessions.delete(deviceCode);
    return {
      done: true,
      provider: "weixin",
      credential: { kind: "weixin", accountId, sessionKey },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("pending") || message.includes("timeout")) {
      return { done: false };
    }
    return { done: false, message };
  }
}

async function postFeishuForm(fetcher: FetchLike, url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  try {
    const response = await fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
    const text = await response.text();
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { error: "parse_error", error_description: text.slice(0, 200) };
    }
  } catch (err) {
    return { error: "network_error", error_description: err instanceof Error ? err.message : String(err) };
  }
}

async function requestWeixinBridge(fetcher: FetchLike, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetcher(resolveWeixinBridgeUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: randomUUID(),
      method,
      params,
    }),
  });
  const payload = await readJsonObject(response);
  const error = readObject(payload, "error");
  if (error) {
    throw new Error(readString(error, "message") ?? `微信 bridge 调用失败：${method}`);
  }
  if (!response.ok) {
    throw new Error(`微信 bridge HTTP ${response.status}`);
  }
  return readObject(payload, "result") ?? payload;
}

function resolveWeixinBridgeUrl(): string {
  return (
    process.env.DEEPSEEK_GUI_WEIXIN_BRIDGE_URL?.trim() ||
    process.env.DEEPSEEK_GUI_OPENCLAW_GATEWAY_URL?.trim() ||
    process.env.OPENCLAW_GATEWAY_URL?.trim() ||
    DEFAULT_WEIXIN_BRIDGE_RPC_URL
  );
}

function resolveImWebhookUrl(): string {
  const explicitUrl = process.env.IM_WEBHOOK_URL?.trim();
  if (explicitUrl) return explicitUrl;
  const port = parseInt(process.env.IM_WEBHOOK_PORT || "", 10) || DEFAULT_IM_WEBHOOK_PORT;
  const rawPath = process.env.IM_WEBHOOK_PATH?.trim() || DEFAULT_IM_WEBHOOK_PATH;
  const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  return `http://127.0.0.1:${port}${path}`;
}

async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json().catch(() => ({}));
  return isRecord(value) ? value : {};
}

function readObject(source: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = source[key];
  return isRecord(value) ? value : undefined;
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readFirstString(source: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = readString(source, key);
    if (value) return value;
  }
  return undefined;
}

function readNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(source: Record<string, unknown>, key: string): boolean {
  return source[key] === true;
}

function readFeishuDomain(payload: Record<string, unknown>, fallback: "feishu" | "lark"): "feishu" | "lark" {
  const userInfo = readObject(payload, "user_info");
  const tenantBrand = userInfo ? readString(userInfo, "tenant_brand") : undefined;
  return tenantBrand === "lark" || tenantBrand === "Lark" ? "lark" : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
