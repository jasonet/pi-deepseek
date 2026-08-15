import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import lockfile from "proper-lockfile";
import { parseDocument } from "yaml";

import type { DshWebStatus } from "../src/ipc";

const DEFAULT_DSH_WEB_URL = "http://127.0.0.1:3080";
const DSH_PROBE_TIMEOUT_MS = 2_000;
const DSH_CREDENTIAL_PROBE_TIMEOUT_MS = 2_000;
const DSH_LOCK_TIMEOUT_MS = 2_000;
const DSH_LOCK_RETRY_INITIAL_MS = 20;
const DSH_LOCK_RETRY_MAX_MS = 200;
const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";
const DSH_START_COMMAND = "env -u DEEPSEEK_API_KEY npx @deepseek-ai/dsh web";
const DSH_NOT_RUNNING_MESSAGE =
  `未检测到本机 DSH Web 服务。请在终端运行：${DSH_START_COMMAND}`;

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

// Mirrors @deepseek-ai/dsh-atomic-write@0.1.0-rc.6 without importing its ESM-only package
// into the CommonJS Electron main bundle. DSH uses this exact sibling-lock protocol.
async function withDshFileLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lockPath = `${path}.lock`;
  const deadline = Date.now() + DSH_LOCK_TIMEOUT_MS;
  let delay = DSH_LOCK_RETRY_INITIAL_MS;
  for (;;) {
    try {
      await writeFile(lockPath, `${process.pid}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
      break;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for the DSH credentials writer lock at ${lockPath}.`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
    delay = Math.min(delay * 2, DSH_LOCK_RETRY_MAX_MS);
  }
  try {
    return await operation();
  } finally {
    await rm(lockPath, { force: true });
  }
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
