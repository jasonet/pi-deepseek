import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseDocument } from "yaml";

import type { DshWebStatus } from "../src/ipc";

const DEFAULT_DSH_WEB_URL = "http://127.0.0.1:3080";
const DSH_PROBE_TIMEOUT_MS = 2_000;
const DSH_CREDENTIAL_PROBE_TIMEOUT_MS = 2_000;
const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";
const DSH_START_COMMAND = "env -u DEEPSEEK_API_KEY npx @deepseek-ai/dsh web";
const DSH_NOT_RUNNING_MESSAGE =
  `未检测到本机 DSH Web 服务。请在终端运行：${DSH_START_COMMAND}`;

interface DshCredentialSyncOptions {
  readonly agentDir?: string;
  readonly dshHome?: string;
  readonly fetchImpl?: typeof fetch;
}

export interface DshCredentialSyncResult {
  readonly status: "unchanged" | "synced" | "unavailable";
  readonly source?: "dsh" | "pi";
}

type CredentialValidity = "valid" | "invalid" | "unavailable";

export class DshWebService {
  private pendingStart: Promise<DshWebStatus> | undefined;
  private status: DshWebStatus = { state: "idle" };

  async getStatus(): Promise<DshWebStatus> {
    if (this.status.state !== "running" || !this.status.url) {
      return this.status;
    }
    if (await probeDshWeb(this.status.url)) {
      return this.status;
    }
    this.status = notRunningStatus();
    return this.status;
  }

  start(): Promise<DshWebStatus> {
    if (this.pendingStart) {
      return this.pendingStart;
    }

    this.pendingStart = this.connect().finally(() => {
      this.pendingStart = undefined;
    });
    return this.pendingStart;
  }

  stop(): Promise<DshWebStatus> {
    this.pendingStart = undefined;
    this.status = { state: "idle" };
    return Promise.resolve(this.status);
  }

  private async connect(): Promise<DshWebStatus> {
    const url = resolveDshWebUrl();
    this.status = { state: "starting" };
    const credentialSync = syncDshDeepSeekCredential().catch((error) => {
      console.warn("[DSH Web] Could not sync DeepSeek credentials:", error instanceof Error ? error.message : error);
    });
    const isRunning = await probeDshWeb(url);
    await credentialSync;
    if (isRunning) {
      this.status = {
        state: "running",
        url,
      };
    } else {
      this.status = notRunningStatus();
    }
    return this.status;
  }
}

export async function syncDshDeepSeekCredential(
  options: DshCredentialSyncOptions = {},
): Promise<DshCredentialSyncResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const dshHome = resolveUserPath(options.dshHome ?? process.env.DSH_HOME, join(homedir(), ".dsh"));
  const agentDir = resolveUserPath(
    options.agentDir ?? process.env.PI_CODING_AGENT_DIR,
    join(homedir(), ".pi", "agent"),
  );
  const credentialsPath = join(dshHome, ".credentials.yaml");
  const existingText = await readOptionalText(credentialsPath);
  const document = parseDocument(existingText ?? "{}");
  if (document.errors.length > 0) {
    throw new Error(`Invalid DSH credentials file at ${credentialsPath}.`);
  }

  const existingKey = document.get("DEEPSEEK_API_KEY");
  const normalizedExistingKey = typeof existingKey === "string" ? existingKey.trim() : undefined;
  const appKey = await readPiDeepSeekApiKey(join(agentDir, "auth.json"));
  if (normalizedExistingKey && normalizedExistingKey === appKey) {
    const validity = await getDeepSeekCredentialValidity(normalizedExistingKey, fetchImpl);
    await chmod(credentialsPath, 0o600);
    return validity === "valid"
      ? { status: "unchanged", source: "dsh" }
      : { status: "unavailable", source: "dsh" };
  }

  const [existingKeyValidity, appKeyValidity] = await Promise.all([
    normalizedExistingKey ? getDeepSeekCredentialValidity(normalizedExistingKey, fetchImpl) : "invalid",
    appKey ? getDeepSeekCredentialValidity(appKey, fetchImpl) : "invalid",
  ]);
  if (existingKeyValidity === "valid") {
    await chmod(credentialsPath, 0o600);
    return { status: "unchanged", source: "dsh" };
  }
  if (existingKeyValidity === "unavailable") {
    await chmod(credentialsPath, 0o600);
    return { status: "unavailable", source: "dsh" };
  }
  if (!appKey || appKeyValidity !== "valid") {
    return { status: "unavailable" };
  }

  if (await readOptionalText(credentialsPath) !== existingText) {
    return { status: "unchanged", source: "dsh" };
  }
  document.set("DEEPSEEK_API_KEY", appKey);
  await writeCredentialsFile(credentialsPath, document.toString());
  return { status: "synced", source: "pi" };
}

async function readPiDeepSeekApiKey(authPath: string): Promise<string | undefined> {
  const text = await readOptionalText(authPath);
  if (text) {
    const data = JSON.parse(text) as { deepseek?: { type?: unknown; key?: unknown } };
    const credential = data.deepseek;
    if (credential?.type === "api_key" && typeof credential.key === "string" && credential.key.trim()) {
      return credential.key.trim();
    }
  }
  return process.env.DEEPSEEK_API_KEY?.trim() || undefined;
}

function resolveUserPath(configuredPath: string | undefined, fallback: string): string {
  const value = configuredPath?.trim() || fallback;
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return resolve(value);
}

async function getDeepSeekCredentialValidity(
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<CredentialValidity> {
  if (!apiKey.trim()) return "invalid";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DSH_CREDENTIAL_PROBE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(DEEPSEEK_BALANCE_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    await response.body?.cancel();
    if (response.ok) return "valid";
    return response.status === 401 || response.status === 403 ? "invalid" : "unavailable";
  } catch {
    return "unavailable";
  } finally {
    clearTimeout(timeout);
  }
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeCredentialsFile(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, text, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function notRunningStatus(): DshWebStatus {
  return {
    state: "error",
    message: DSH_NOT_RUNNING_MESSAGE,
  };
}

async function probeDshWeb(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DSH_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function resolveDshWebUrl(): string {
  const configured = process.env.PI_APP_DSH_WEB_URL?.trim();
  if (!configured) return `${DEFAULT_DSH_WEB_URL}/`;
  try {
    const url = new URL(configured);
    if (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      return url.toString();
    }
  } catch {}
  return `${DEFAULT_DSH_WEB_URL}/`;
}
