import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { spawn } from "node:child_process";
import lockfile from "proper-lockfile";
import { parseDocument } from "yaml";

import type { DshWebProgress, DshWebStatus } from "../src/ipc";
import { withDshFileLock } from "./dsh-file-lock";
import { dshEnvironment, dshOutputLines, ensureDshRuntime, sanitizeDshLog, stopDshProcess } from "./dsh-managed-runtime";

const DSH_PROBE_TIMEOUT_MS = 2_000;
const DSH_CREDENTIAL_PROBE_TIMEOUT_MS = 2_000;
const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";

interface DshCredentialSyncOptions {
  readonly agentDir?: string;
  readonly dshHome?: string;
  readonly environmentKey?: string | null;
  readonly fetchImpl?: typeof fetch;
}

export interface DshCredentialSyncResult {
  readonly status: "unchanged" | "synced" | "unavailable";
  readonly source?: "dsh" | "pi";
}

type CredentialValidity = "valid" | "invalid" | "unavailable";

interface PiCredentialState {
  readonly canPersistStoredCredential: boolean;
  readonly environmentKey?: string;
  readonly storedCredential?: unknown;
  readonly storedKey?: string;
}

export class DshWebService {
  private pendingStart: Promise<DshWebStatus> | undefined;
  private pendingStop: Promise<DshWebStatus> | undefined;
  private pendingRestart: Promise<DshWebStatus> | undefined;
  private controller: AbortController | undefined;
  private status: DshWebStatus = { state: "idle" };
  private childProcess: ReturnType<typeof spawn> | undefined;
  private disposed = false;

  constructor(private readonly options: {
    readonly runtimeRoot: string;
    readonly install?: typeof ensureDshRuntime;
    readonly syncCredentials?: typeof syncDshDeepSeekCredential;
    readonly externalUrl?: string;
    readonly launchTimeoutMs?: number;
  }) {}

  async checkDsBotInstalled(options: { dshHome?: string } = {}): Promise<boolean> {
    return checkDsBotInstalled(options);
  }

  async getStatus(): Promise<DshWebStatus> {
    const current = this.status;
    if (current.state === "running" && !await probeDshWeb(current.url) && this.status === current) {
      this.status = { ...current, state: "error", message: "DSH 服务连接已断开，请重试或重启。" };
    }
    return this.status;
  }

  start(): Promise<DshWebStatus> {
    if (this.disposed) return Promise.resolve({ state: "idle" });
    if (this.pendingStop) return this.pendingStop.then(() => this.start());
    if (this.pendingStart) return this.pendingStart;
    if (this.status.state === "running") return Promise.resolve(this.status);
    const controller = new AbortController();
    this.controller = controller;
    this.status = { state: "starting", managed: !this.externalUrl, logs: [] };
    this.pendingStart = this.startService(controller.signal).catch(async (error) => {
      if (this.childProcess) {
        const child = this.childProcess;
        this.childProcess = undefined;
        await stopDshProcess(child);
      }
      if (!controller.signal.aborted) this.status = {
        ...this.status, state: "error",
        message: sanitizeDshLog(error instanceof Error ? error.message : String(error)),
      };
      return this.status;
    }).finally(() => { this.pendingStart = undefined; });
    return this.pendingStart;
  }

  launch(): Promise<DshWebStatus> { return this.start(); }

  shutdown(): Promise<DshWebStatus> {
    this.disposed = true;
    return this.stop();
  }

  restart(): Promise<DshWebStatus> {
    if (this.pendingRestart) return this.pendingRestart;
    this.pendingRestart = this.stop().then(() => this.start()).finally(() => { this.pendingRestart = undefined; });
    return this.pendingRestart;
  }

  stop(): Promise<DshWebStatus> {
    if (this.pendingStop) return this.pendingStop;
    this.status = { ...this.status, state: "stopping" };
    this.controller?.abort();
    this.pendingStop = (async () => {
      const child = this.childProcess;
      this.childProcess = undefined;
      if (child) await stopDshProcess(child);
      await this.pendingStart;
      this.status = { state: "idle" };
      return this.status;
    })().finally(() => { this.pendingStop = undefined; });
    return this.pendingStop;
  }

  private get externalUrl(): string | undefined {
    return this.options.externalUrl ?? (process.env.PI_APP_DSH_WEB_URL?.trim() || undefined);
  }

  private report(update: DshWebProgress & { readonly line?: string }): void {
    const { line, ...progress } = update;
    const logs = line ? [...(this.status.logs ?? []), sanitizeDshLog(line)].slice(-80) : this.status.logs;
    this.status = { ...this.status, ...progress, logs };
  }

  private async startService(signal: AbortSignal): Promise<DshWebStatus> {
    if (this.childProcess) {
      const child = this.childProcess;
      this.childProcess = undefined;
      await stopDshProcess(child);
    }
    signal.throwIfAborted();
    if (this.externalUrl) {
      const url = validateLocalDshUrl(this.externalUrl);
      if (!await probeDshWeb(url)) throw new Error("指定的本机 DSH 服务未运行。请启动该服务后重试。");
      signal.throwIfAborted();
      this.status = { state: "running", managed: false, url, port: Number(new URL(url).port) };
      return this.status;
    }
    this.status = { state: "installing", managed: true, logs: [] };
    const runtime = await (this.options.install ?? ensureDshRuntime)(this.options.runtimeRoot, signal, (update) => {
      if (!signal.aborted) this.report(update);
    });
    signal.throwIfAborted();
    this.status = { ...this.status, state: "launching", phase: "service", progress: undefined };
    this.report({ line: "同步本机 DeepSeek 凭据" });
    await (this.options.syncCredentials ?? syncDshDeepSeekCredential)().catch(() => {
      this.report({ line: "凭据同步未完成，可在 Harness 中配置自己的 API Key。" });
    });
    signal.throwIfAborted();
    this.report({ line: "启动本机 Pojia Harness 服务" });
    const child = spawn(runtime.node, [runtime.cli, "web", "--host", "127.0.0.1", "--port", "0", "--no-open"], {
      env: dshEnvironment(runtime.node), cwd: homedir(), detached: process.platform !== "win32",
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    this.childProcess = child;
    const url = await new Promise<string>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => finish(new Error("DSH 服务启动超时，请重试。")), this.options.launchTimeoutMs ?? 90_000);
      const abort = () => finish(new Error("DSH 启动已取消。"));
      const finish = (error?: Error, url?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        error ? reject(error) : resolve(url!);
      };
      const onLine = (line: string) => {
        const match = /^dsh web: (https?:\/\/\S+)/.exec(line);
        if (match && !settled) {
          try { finish(undefined, validateLocalDshUrl(match[1]!)); } catch (error) { finish(error as Error); }
        }
        if (!signal.aborted) this.report({ line });
      };
      signal.addEventListener("abort", abort, { once: true });
      child.stdout?.on("data", dshOutputLines(onLine));
      child.stderr?.on("data", dshOutputLines(onLine));
      child.once("error", (error) => finish(error));
      child.once("exit", (code) => {
        finish(new Error(`DSH 服务已退出 (code ${String(code)})。`));
        if (this.childProcess === child && !signal.aborted) {
          this.status = { ...this.status, state: "error", message: "DSH 服务意外退出，请重启。" };
          void stopDshProcess(child).catch(() => undefined);
        }
      });
      if (signal.aborted) abort();
    });
    signal.throwIfAborted();
    if (!await probeDshWeb(url)) throw new Error("DSH 已启动，但页面健康检查失败。");
    signal.throwIfAborted();
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("DSH 服务已退出。");
    this.status = { ...this.status, state: "running", url, port: Number(new URL(url).port), pid: child.pid };
    return this.status;
  }
}

export async function checkDsBotInstalled(
  options: { dshHome?: string } = {},
): Promise<boolean> {
  const dshHome = resolveUserPath(options.dshHome ?? process.env.DSH_HOME, join(homedir(), ".dsh"));
  const webPkgPath = join(dshHome, "profiles", "web", "package.json");
  const nodeModulesPath = join(dshHome, "profiles", "web", "node_modules", "ds-bot");

  try {
    const pkgRaw = await readOptionalText(webPkgPath);
    if (!pkgRaw) return false;
    const pkg = JSON.parse(pkgRaw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const hasDep = Boolean(pkg.dependencies?.["ds-bot"] || pkg.devDependencies?.["ds-bot"]);
    if (!hasDep) return false;

    // Check directory existence
    const dirStat = await readFile(join(nodeModulesPath, "package.json"), "utf8").catch(() => null);
    return Boolean(dirStat);
  } catch {
    return false;
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
  const authPath = join(agentDir, "auth.json");
  const existingText = await readOptionalText(credentialsPath);
  if (existingText !== undefined) await chmod(credentialsPath, 0o600);
  const document = parseDocument(existingText ?? "{}");
  if (document.errors.length > 0) {
    throw new Error(`Invalid DSH credentials file at ${credentialsPath}.`);
  }

  const existingKey = document.get("DEEPSEEK_API_KEY");
  const normalizedExistingKey = typeof existingKey === "string" ? existingKey.trim() : undefined;
  const piCredentials = await readPiCredentials(authPath, options.environmentKey);
  const validityByKey = await validateCredentialCandidates(
    [normalizedExistingKey, piCredentials.storedKey],
    fetchImpl,
  );
  if (
    piCredentials.environmentKey
    && !validityByKey.has(piCredentials.environmentKey)
    && getCandidateValidity(piCredentials.storedKey, validityByKey) !== "valid"
  ) {
    validityByKey.set(
      piCredentials.environmentKey,
      await getDeepSeekCredentialValidity(piCredentials.environmentKey, fetchImpl),
    );
  }
  const existingKeyValidity = getCandidateValidity(normalizedExistingKey, validityByKey);
  const piCandidates = [piCredentials.storedKey, piCredentials.environmentKey].filter(
    (key): key is string => Boolean(key),
  );
  const validPiKey = piCandidates.find((key) => validityByKey.get(key) === "valid");
  const piValidationUnavailable = piCandidates.some((key) => validityByKey.get(key) === "unavailable");

  if (existingKeyValidity === "valid") {
    if (!validPiKey && !piValidationUnavailable) {
      if (!piCredentials.canPersistStoredCredential) return { status: "unavailable", source: "pi" };
      const synced = await writePiCredentials(
        authPath,
        credentialsPath,
        existingText,
        piCredentials.storedCredential,
        normalizedExistingKey!,
      );
      return synced ? { status: "synced", source: "dsh" } : { status: "unchanged", source: "dsh" };
    }
    return { status: "unchanged", source: "dsh" };
  }
  if (existingKeyValidity === "unavailable") {
    return { status: "unavailable", source: "dsh" };
  }
  if (!validPiKey) {
    return { status: "unavailable" };
  }

  const expectedPiCredential = validPiKey === piCredentials.storedKey
    ? piCredentials.storedCredential
    : undefined;
  const synced = await writeDshCredentials(
    credentialsPath,
    existingText,
    validPiKey,
    expectedPiCredential === undefined ? undefined : { authPath, credential: expectedPiCredential },
  );
  return synced ? { status: "synced", source: "pi" } : { status: "unchanged", source: "dsh" };
}

async function readPiCredentials(
  authPath: string,
  configuredEnvironmentKey: string | null | undefined,
): Promise<PiCredentialState> {
  const text = await readOptionalText(authPath);
  let canPersistStoredCredential = true;
  let storedCredential: unknown;
  let storedKey: string | undefined;
  if (text) {
    await chmod(authPath, 0o600);
    const parsed = parsePiCredentialData(text);
    if (parsed) {
      storedCredential = parsed.deepseek;
      const credential = storedCredential as { type?: unknown; key?: unknown } | undefined;
      if (credential?.type === "api_key" && typeof credential.key === "string" && credential.key.trim()) {
        storedKey = credential.key.trim();
      }
    } else {
      canPersistStoredCredential = false;
    }
  }
  const rawEnvironmentKey = configuredEnvironmentKey === undefined
    ? process.env.DEEPSEEK_API_KEY
    : configuredEnvironmentKey;
  return {
    canPersistStoredCredential,
    environmentKey: rawEnvironmentKey?.trim() || undefined,
    storedCredential,
    storedKey,
  };
}

async function validateCredentialCandidates(
  candidates: readonly (string | undefined)[],
  fetchImpl: typeof fetch,
): Promise<Map<string, CredentialValidity>> {
  const uniqueCandidates = [...new Set(candidates.filter((key): key is string => Boolean(key)))];
  const validities = await Promise.all(
    uniqueCandidates.map((key) => getDeepSeekCredentialValidity(key, fetchImpl)),
  );
  return new Map(uniqueCandidates.map((key, index) => [key, validities[index]!]));
}

function getCandidateValidity(
  candidate: string | undefined,
  validityByKey: ReadonlyMap<string, CredentialValidity>,
): CredentialValidity {
  return candidate ? validityByKey.get(candidate) ?? "unavailable" : "invalid";
}

async function writePiCredentials(
  authPath: string,
  dshCredentialsPath: string,
  expectedDshText: string | undefined,
  expectedPiCredential: unknown,
  apiKey: string,
): Promise<boolean> {
  return withDshFileLock(dshCredentialsPath, async () => {
    if (await readOptionalText(dshCredentialsPath) !== expectedDshText) return false;
    await ensurePrivateJsonFile(authPath);
    return (await withPiAuthLock(authPath, async () => {
      const latestText = await readFile(authPath, "utf8");
      const latestData = parsePiCredentialData(latestText);
      if (!latestData) return false;
      if (!isDeepStrictEqual(latestData.deepseek, expectedPiCredential)) return false;
      const nextData = {
        ...latestData,
        deepseek: { type: "api_key", key: apiKey },
      };
      await writePrivateFile(authPath, `${JSON.stringify(nextData, null, 2)}\n`);
      return true;
    })) ?? false;
  });
}

async function withPiAuthLock<T>(authPath: string, operation: () => Promise<T>): Promise<T | undefined> {
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(authPath, {
      realpath: false,
      retries: { retries: 9, factor: 1, minTimeout: 20, maxTimeout: 20 },
    });
  } catch (error) {
    if (isNodeError(error) && error.code === "ELOCKED") return undefined;
    throw error;
  }
  try {
    return await operation();
  } finally {
    await release();
  }
}

function parsePiCredentialData(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

async function ensurePrivateJsonFile(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await writeFile(path, "{}\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") throw error;
  }
  await chmod(path, 0o600);
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

async function writeDshCredentials(
  path: string,
  expectedText: string | undefined,
  apiKey: string,
  expectedPiSource?: { readonly authPath: string; readonly credential: unknown },
): Promise<boolean> {
  return withDshFileLock(path, async () => {
    const latestText = await readOptionalText(path);
    if (latestText !== expectedText) return false;
    const commit = async (): Promise<boolean> => {
      if (expectedPiSource) {
        const latestAuthText = await readFile(expectedPiSource.authPath, "utf8");
        const latestAuth = parsePiCredentialData(latestAuthText);
        if (!latestAuth || !isDeepStrictEqual(latestAuth.deepseek, expectedPiSource.credential)) {
          return false;
        }
      }
      const document = parseDocument(latestText ?? "{}");
      if (document.errors.length > 0) return false;
      document.set("DEEPSEEK_API_KEY", apiKey);
      await writePrivateFile(path, document.toString());
      return true;
    };
    if (!expectedPiSource) return commit();
    return (await withPiAuthLock(expectedPiSource.authPath, commit)) ?? false;
  });
}

async function writePrivateFile(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temporaryPath, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function probeDshWeb(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DSH_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "manual" });
    await response.body?.cancel();
    // DSH exchanges the printed token for a cookie, then redirects to a clean URL.
    // Node fetch does not keep that cookie automatically as the embedded browser does.
    if (response.status === 303 && response.headers.has("set-cookie")) {
      const target = new URL(response.headers.get("location") ?? "./", url);
      if (target.origin !== new URL(url).origin) return false;
      const cookie = response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
      const page = await fetch(target, { headers: { cookie }, signal: controller.signal, redirect: "error" });
      await page.body?.cancel();
      return page.ok;
    }
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function validateLocalDshUrl(configured: string): string {
  try {
    const url = new URL(configured);
    if (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      return url.toString();
    }
  } catch {}
  throw new Error("DSH 服务地址必须是本机 HTTP 地址。");
}
