import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { parseDocument } from "yaml";
import type { SaveTregSettingsInput, TregSettings, TregStatus } from "../src/ipc";
import { withDshFileLock } from "./dsh-file-lock";

const DEFAULT_SERVICE_URL = "https://treg.to/mcp/";
const PROBE_TIMEOUT_MS = 8_000;

export interface TregServiceOptions {
  readonly policyPath?: string;
  readonly tregConfigPath?: string;
  readonly dshCredentialsPath?: string;
  readonly dshProfileRoot?: string;
  readonly dshManagedMarkerPath?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDir?: string;
}

interface TregCredential {
  readonly token: string;
  readonly source: "env" | "config";
  readonly baseUrl?: string;
}

export const DEFAULT_TREG_SETTINGS: TregSettings = {
  enabled: false,
  piEnabled: true,
  harnessEnabled: false,
  serviceUrl: DEFAULT_SERVICE_URL,
  paidCalls: "ask",
  allowMutatingCalls: false,
  workspaceRoots: [],
};

export class TregService {
  readonly #env: NodeJS.ProcessEnv;
  readonly #homeDir: string;
  readonly #policyPath: string;
  readonly #tregConfigPath: string;
  readonly #dshCredentialsPath: string;
  readonly #dshProfileRoot: string;
  readonly #dshManagedMarkerPath: string;

  constructor(options: TregServiceOptions = {}) {
    this.#env = options.env ?? process.env;
    this.#homeDir = options.homeDir ?? homedir();
    const defaultPolicyPath = this.#env.PI_CODING_AGENT_DIR?.trim()
      ? path.join(this.#env.PI_CODING_AGENT_DIR, "treg.json")
      : path.join(this.#homeDir, ".pi", "agent", "treg.json");
    this.#policyPath = options.policyPath
      ?? resolveUserPath(this.#env.PI_TREG_POLICY_PATH, defaultPolicyPath, this.#homeDir);
    this.#tregConfigPath = options.tregConfigPath
      ?? resolveUserPath(this.#env.TREG_CONFIG, path.join(this.#homeDir, ".treg", "config.json"), this.#homeDir);
    const dshHome = resolveUserPath(this.#env.DSH_HOME, path.join(this.#homeDir, ".dsh"), this.#homeDir);
    this.#dshCredentialsPath = options.dshCredentialsPath ?? path.join(dshHome, ".credentials.yaml");
    this.#dshProfileRoot = options.dshProfileRoot ?? path.join(dshHome, "profiles", "web");
    this.#dshManagedMarkerPath = options.dshManagedMarkerPath ?? `${this.#policyPath}.harness-managed`;
  }

  async getStatus(probe = true): Promise<TregStatus> {
    const settings = await this.getSettings();
    const credential = await this.#discoverCredential();
    const harnessInstalled = await fileExists(path.join(this.#dshProfileRoot, "node_modules", "treg-dsh", "package.json"));
    const status: TregStatus = {
      settings,
      tokenConfigured: Boolean(credential),
      tokenSource: credential?.source,
      connected: false,
      harnessInstalled,
    };
    if (!credential || !probe || !settings.enabled) return status;
    if (!credentialMatchesService(credential, settings.serviceUrl)) {
      return { ...status, message: "The detected Treg login belongs to a different service URL." };
    }

    try {
      const balanceUsd = await probeBalance(settings.serviceUrl, credential.token);
      return { ...status, connected: true, balanceUsd };
    } catch (error) {
      return { ...status, message: safeErrorMessage(error) };
    }
  }

  async getSettings(): Promise<TregSettings> {
    try {
      const parsed = JSON.parse(await readFile(this.#policyPath, "utf8")) as Partial<TregSettings>;
      return normalizeSettings(parsed);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return DEFAULT_TREG_SETTINGS;
      if (error instanceof SyntaxError) return DEFAULT_TREG_SETTINGS;
      throw error;
    }
  }

  async saveSettings(input: SaveTregSettingsInput): Promise<TregStatus> {
    const previous = await this.getSettings();
    const settings = normalizeSettings(input);
    await writePrivateFile(this.#policyPath, `${JSON.stringify(settings, null, 2)}\n`);
    if (previous.harnessEnabled && !settings.harnessEnabled) {
      await this.#removeManagedHarnessCredential();
    }
    return this.getStatus(false);
  }

  async installHarnessPlugin(): Promise<{ ok: boolean; message: string }> {
    const settings = await this.getSettings();
    if (!settings.enabled || !settings.harnessEnabled) {
      return { ok: false, message: "Enable Treg and the DeepSeek Harness target in Settings before installing it." };
    }
    if (new URL(settings.serviceUrl).origin !== new URL(DEFAULT_SERVICE_URL).origin) {
      return { ok: false, message: "The official DeepSeek Harness plugin supports treg.to only." };
    }
    const credential = await this.#discoverCredential();
    if (!credential) {
      return { ok: false, message: "No Treg login was found. Sign in with Treg first, then retry." };
    }

    if (!credentialMatchesService(credential, DEFAULT_SERVICE_URL)) {
      return { ok: false, message: "The official DeepSeek Harness plugin supports treg.to credentials only." };
    }
    const result = await runCommand(
      "npx",
      ["--yes", "@deepseek-ai/dsh", "plugin", "--profile", "web", "add", "github:superdesigndev/treg"],
      this.#env,
      [credential.token],
    );
    if (!result.ok) return result;
    await this.#syncHarnessCredential(credential.token);
    return { ok: true, message: "Treg was added to the DeepSeek Harness web profile. Restart dsh web to load it." };
  }

  async #discoverCredential(): Promise<TregCredential | undefined> {
    const envToken = this.#env.TREG_TOKEN?.trim();
    if (envToken) return { token: envToken, source: "env" };
    try {
      const parsed = JSON.parse(await readFile(this.#tregConfigPath, "utf8")) as { token?: unknown; base_url?: unknown };
      const token = typeof parsed.token === "string" ? parsed.token.trim() : "";
      if (!token) return undefined;
      if (process.platform !== "win32") await chmod(this.#tregConfigPath, 0o600).catch(() => undefined);
      const baseUrl = typeof parsed.base_url === "string" && parsed.base_url.trim()
        ? parsed.base_url.trim()
        : undefined;
      return { token, source: "config", baseUrl };
    } catch {
      return undefined;
    }
  }

  async #syncHarnessCredential(token: string): Promise<void> {
    const fingerprint = credentialFingerprint(token);
    await writePrivateFile(this.#dshManagedMarkerPath, `${fingerprint}\n`);
    try {
      await withDshFileLock(this.#dshCredentialsPath, async () => {
        const current = await readOptionalText(this.#dshCredentialsPath);
        const document = parseDocument(current ?? "{}");
        if (document.errors.length > 0) {
          throw new Error("DeepSeek Harness credentials YAML is invalid; fix it before enabling Treg.");
        }
        document.set("TREG_TOKEN", token);
        await writePrivateFile(this.#dshCredentialsPath, document.toString());
      });
    } catch (error) {
      await rm(this.#dshManagedMarkerPath, { force: true });
      throw error;
    }
  }

  async #removeManagedHarnessCredential(): Promise<void> {
    const fingerprint = (await readOptionalText(this.#dshManagedMarkerPath))?.trim();
    if (!fingerprint) return;
    await withDshFileLock(this.#dshCredentialsPath, async () => {
      const current = await readOptionalText(this.#dshCredentialsPath);
      if (!current) return;
      const document = parseDocument(current);
      if (document.errors.length > 0) {
        throw new Error("DeepSeek Harness credentials YAML is invalid; Treg was disabled but its managed credential could not be removed.");
      }
      const token = document.get("TREG_TOKEN");
      if (typeof token === "string" && credentialFingerprint(token) === fingerprint) {
        document.delete("TREG_TOKEN");
        await writePrivateFile(this.#dshCredentialsPath, document.toString());
      }
    });
    await rm(this.#dshManagedMarkerPath, { force: true });
  }
}

function credentialFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function credentialMatchesService(credential: TregCredential, serviceUrl: string): boolean {
  if (!credential.baseUrl) return true;
  try {
    return new URL(credential.baseUrl).origin === new URL(serviceUrl).origin;
  } catch {
    return false;
  }
}

export function normalizeSettings(input: Partial<TregSettings>): TregSettings {
  const roots = Array.isArray(input.workspaceRoots)
    ? [...new Set(input.workspaceRoots
      .filter((root): root is string => typeof root === "string" && root.trim() !== "")
      .map((root) => path.resolve(root.trim())))]
    : [];
  return {
    enabled: input.enabled === true,
    piEnabled: input.piEnabled !== false,
    harnessEnabled: input.harnessEnabled === true,
    serviceUrl: normalizeServiceUrl(input.serviceUrl ?? DEFAULT_SERVICE_URL),
    paidCalls: input.paidCalls === "disabled" ? "disabled" : "ask",
    allowMutatingCalls: input.allowMutatingCalls === true,
    workspaceRoots: roots,
  };
}

function normalizeServiceUrl(value: string): string {
  const url = new URL(value.trim());
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error("Treg service URL must use HTTPS (HTTP is allowed only for loopback testing).");
  }
  url.hash = "";
  return url.toString();
}

async function probeBalance(serviceUrl: string, token: string): Promise<number | undefined> {
  const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
  ]);
  const client = new Client({ name: "pi-deepseek-treg-status", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(serviceUrl), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    await client.connect(transport, { signal: controller.signal, timeout: PROBE_TIMEOUT_MS });
    const result = await client.callTool(
      { name: "balance", arguments: {} },
      undefined,
      { signal: controller.signal, timeout: PROBE_TIMEOUT_MS },
    );
    const structured = result.structuredContent as { balance_usd?: unknown; error?: unknown } | undefined;
    if (typeof structured?.error === "string") throw new Error(structured.error);
    if (typeof structured?.balance_usd === "number") return structured.balance_usd;
    const content = Array.isArray(result.content) ? result.content : [];
    for (const item of content) {
      if (item.type !== "text") continue;
      try {
        const parsed = JSON.parse(item.text) as { balance_usd?: unknown; error?: unknown };
        if (typeof parsed.error === "string") throw new Error(parsed.error);
        if (typeof parsed.balance_usd === "number") return parsed.balance_usd;
      } catch (error) {
        if (error instanceof SyntaxError) continue;
        throw error;
      }
    }
    return undefined;
  } finally {
    clearTimeout(timeout);
    await client.close().catch(() => undefined);
  }
}

async function runCommand(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  sensitiveValues: readonly string[] = [],
): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    const childEnv = { ...env };
    delete childEnv.TREG_TOKEN;
    const child = spawn(command, args, { env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let settled = false;
    let forceTimer: NodeJS.Timeout | undefined;
    let giveUpTimer: NodeJS.Timeout | undefined;
    const append = (chunk: Buffer) => { output = `${output}${chunk.toString("utf8")}`.slice(-6_000); };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const finish = (result: { ok: boolean; message: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceTimer) clearTimeout(forceTimer);
      if (giveUpTimer) clearTimeout(giveUpTimer);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      forceTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
      giveUpTimer = setTimeout(() => finish({ ok: false, message: "DeepSeek Harness plugin installation timed out." }), 3_000);
    }, 180_000);
    child.on("error", (error) => finish({ ok: false, message: `Could not start DeepSeek Harness: ${error.message}` }));
    child.on("close", (code) => {
      const summary = sensitiveValues.reduce(
        (message, value) => value ? message.replaceAll(value, "<redacted>") : message,
        output.trim().split("\n").slice(-4).join("\n"),
      );
      finish(code === 0
        ? { ok: true, message: summary || "DeepSeek Harness plugin installed." }
        : { ok: false, message: summary || `DeepSeek Harness exited with code ${code ?? "unknown"}.` });
    });
  });
}

async function writePrivateFile(filePath: string, text: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temporaryPath, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporaryPath, filePath);
    if (process.platform !== "win32") await chmod(filePath, 0o600);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function readOptionalText(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveUserPath(value: string | undefined, fallback: string, homeDir: string): string {
  const configured = value?.trim() || fallback;
  if (configured === "~") return homeDir;
  if (configured.startsWith("~/")) return path.join(homeDir, configured.slice(2));
  return path.resolve(configured);
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Treg connection failed.";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
