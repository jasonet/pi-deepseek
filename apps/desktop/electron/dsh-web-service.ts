import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { parseDocument } from "yaml";

import type { DshWebStatus } from "../src/ipc";

interface DshCli {
  readonly path: string;
  readonly version?: string;
}

interface NodeRuntime {
  readonly path: string;
  readonly electronRunAsNode: boolean;
}

export type DshCredentialProbeResult = "valid" | "invalid" | "unknown";

export interface DshCredentialCandidate {
  readonly source: "environment" | "file";
  readonly value: string;
}

export interface DshCredentialSelection {
  readonly apiKey?: string;
  readonly clearInherited: boolean;
}

const START_TIMEOUT_MS = 30_000;
const CREDENTIAL_PROBE_TIMEOUT_MS = 8_000;
const DSH_URL_PATTERN = /dsh web:\s*(http:\/\/(?:127\.0\.0\.1|localhost):\d+)/i;
const DEEPSEEK_MODELS_URL = "https://api.deepseek.com/models";

export class DshWebService {
  private child: ChildProcess | undefined;
  private pendingStart: Promise<DshWebStatus> | undefined;
  private status: DshWebStatus = { state: "idle", installed: false };

  getStatus(): DshWebStatus {
    if (this.status.state === "idle") {
      const cli = resolveDshCli();
      return {
        state: "idle",
        installed: Boolean(cli),
        version: cli?.version,
      };
    }
    return this.status;
  }

  start(workspacePath?: string, fallbackApiKey?: string): Promise<DshWebStatus> {
    if (this.status.state === "running") {
      return Promise.resolve(this.status);
    }
    if (this.pendingStart) {
      return this.pendingStart;
    }

    this.pendingStart = this.startServer(workspacePath, fallbackApiKey).finally(() => {
      this.pendingStart = undefined;
    });
    return this.pendingStart;
  }

  async stop(): Promise<DshWebStatus> {
    const child = this.child;
    this.child = undefined;
    this.pendingStart = undefined;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await waitForExit(child, 2_000);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
    const cli = resolveDshCli();
    this.status = { state: "idle", installed: Boolean(cli), version: cli?.version };
    return this.status;
  }

  private async startServer(workspacePath?: string, fallbackApiKey?: string): Promise<DshWebStatus> {
    const externalUrl = resolveExternalUrl();
    if (externalUrl) {
      this.status = { state: "running", installed: true, url: externalUrl, managed: false };
      return this.status;
    }

    const cli = resolveDshCli();
    if (!cli) {
      this.status = {
        state: "error",
        installed: false,
        message: "DeepSeek Harness 未安装。请先运行：npx @deepseek-ai/dsh web",
      };
      return this.status;
    }

    const node = resolveNodeRuntime();
    if (!node) {
      this.status = {
        state: "error",
        installed: true,
        version: cli.version,
        message: "未找到支持 node:module.stripTypeScriptTypes 的 Node.js 运行时。",
      };
      return this.status;
    }

    this.status = { state: "starting", installed: true, version: cli.version };
    const cwd = workspacePath && existsSync(workspacePath) ? workspacePath : homedir();
    const env = { ...process.env };
    const credential = await selectDshLaunchCredential(
      readDshCredentialCandidates(env, cwd),
      fallbackApiKey,
      probeDeepseekApiKey,
    );
    if (credential.apiKey) {
      env.DEEPSEEK_API_KEY = credential.apiKey;
    } else if (credential.clearInherited) {
      delete env.DEEPSEEK_API_KEY;
    }
    if (node.electronRunAsNode) {
      env.ELECTRON_RUN_AS_NODE = "1";
    }

    return new Promise<DshWebStatus>((resolve) => {
      const child = spawn(node.path, [cli.path, "web", "--host", "127.0.0.1", "--port", "0"], {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.child = child;
      let settled = false;
      let output = "";

      const finish = (status: DshWebStatus) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.status = status;
        resolve(status);
      };
      const capture = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-8_000);
        const match = output.match(DSH_URL_PATTERN);
        if (match?.[1]) {
          finish({
            state: "running",
            installed: true,
            version: cli.version,
            url: match[1],
            managed: true,
          });
        }
      };
      child.stdout?.on("data", capture);
      child.stderr?.on("data", capture);
      child.once("error", (error) => {
        this.child = undefined;
        finish({
          state: "error",
          installed: true,
          version: cli.version,
          message: `DeepSeek Harness 启动失败：${error.message}`,
        });
      });
      child.once("exit", (code, signal) => {
        this.child = undefined;
        const detail = cleanProcessOutput(output) || `退出码 ${code ?? signal ?? "unknown"}`;
        if (!settled) {
          finish({
            state: "error",
            installed: true,
            version: cli.version,
            message: `DeepSeek Harness 启动失败：${detail}`,
          });
        } else if (this.status.state === "running") {
          this.status = {
            state: "error",
            installed: true,
            version: cli.version,
            message: `DeepSeek Harness 已停止：${detail}`,
          };
        }
      });

      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        finish({
          state: "error",
          installed: true,
          version: cli.version,
          message: `DeepSeek Harness 在 ${START_TIMEOUT_MS / 1_000} 秒内未完成启动。${cleanProcessOutput(output)}`,
        });
      }, START_TIMEOUT_MS);
    });
  }
}

export async function selectDshLaunchCredential(
  candidates: readonly DshCredentialCandidate[],
  fallbackApiKey: string | undefined,
  probe: (apiKey: string) => Promise<DshCredentialProbeResult>,
): Promise<DshCredentialSelection> {
  const uniqueCandidates = deduplicateCredentialCandidates(candidates);
  for (const candidate of uniqueCandidates) {
    const result = await probe(candidate.value);
    if (result !== "invalid") {
      return { apiKey: candidate.value, clearInherited: false };
    }
  }

  const fallback = fallbackApiKey?.trim();
  if (fallback && !uniqueCandidates.some((candidate) => candidate.value === fallback)) {
    const result = await probe(fallback);
    if (result !== "invalid") {
      return { apiKey: fallback, clearInherited: false };
    }
  }

  return {
    clearInherited: uniqueCandidates.some((candidate) => candidate.source === "environment"),
  };
}

function deduplicateCredentialCandidates(
  candidates: readonly DshCredentialCandidate[],
): readonly DshCredentialCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (!candidate.value || seen.has(candidate.value)) return false;
    seen.add(candidate.value);
    return true;
  });
}

function readDshCredentialCandidates(
  env: NodeJS.ProcessEnv,
  cwd: string,
): readonly DshCredentialCandidate[] {
  const candidates: DshCredentialCandidate[] = [];
  const inherited = env.DEEPSEEK_API_KEY?.trim();
  if (inherited) candidates.push({ source: "environment", value: inherited });

  const dshHome = resolveDshHome(env.DSH_HOME);
  const stored = readStoredDshDeepseekApiKey(dshHome);
  if (stored) candidates.push({ source: "file", value: stored });
  for (const envPath of [path.join(cwd, ".env"), path.join(dshHome, ".env")]) {
    const value = readDotEnvDeepseekApiKey(envPath);
    if (value) candidates.push({ source: "file", value });
  }
  return candidates;
}

function resolveDshHome(configuredHome: string | undefined): string {
  return expandHome(configuredHome?.trim() || path.join(homedir(), ".dsh"));
}

function readStoredDshDeepseekApiKey(dshHome: string): string | undefined {
  try {
    const document = parseDocument(readFileSync(path.join(dshHome, ".credentials.yaml"), "utf8"), {
      prettyErrors: false,
      uniqueKeys: true,
    });
    if (document.errors.length > 0) return undefined;
    const value = document.get("DEEPSEEK_API_KEY");
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

function readDotEnvDeepseekApiKey(filePath: string): string | undefined {
  try {
    const value = parseEnv(readFileSync(filePath, "utf8")).DEEPSEEK_API_KEY?.trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith(`~${path.sep}`)) return path.join(homedir(), value.slice(2));
  return path.resolve(value);
}

async function probeDeepseekApiKey(apiKey: string): Promise<DshCredentialProbeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CREDENTIAL_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(DEEPSEEK_MODELS_URL, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (response.ok) return "valid";
    if (response.status === 401 || response.status === 403) return "invalid";
    return "unknown";
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timeout);
  }
}

function resolveExternalUrl(): string | undefined {
  const value = process.env.PI_APP_DSH_WEB_URL?.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function resolveDshCli(): DshCli | undefined {
  const candidates: string[] = [];
  const explicit = process.env.PI_APP_DSH_CLI_PATH?.trim();
  if (explicit) candidates.push(explicit);

  const pathCommand = process.platform === "win32" ? "where" : "which";
  const located = spawnSync(pathCommand, ["dsh"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (located.status === 0) {
    candidates.push(...located.stdout.split(/\r?\n/).filter(Boolean));
  }

  const home = homedir();
  for (const root of [
    path.join(home, ".npm", "_npx"),
    "/opt/homebrew/lib/node_modules",
    "/usr/local/lib/node_modules",
    path.join(process.env.APPDATA ?? "", "npm", "node_modules"),
  ]) {
    candidates.push(...findDshPackages(root));
  }

  const resolved = candidates
    .map(resolveCliCandidate)
    .filter((candidate): candidate is DshCli => Boolean(candidate))
    .sort((left, right) => fileMtime(right.path) - fileMtime(left.path));
  return resolved[0];
}

function findDshPackages(root: string): string[] {
  if (!root || !existsSync(root)) return [];
  const direct = path.join(root, "@deepseek-ai", "dsh");
  if (existsSync(direct)) return [direct];
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name, "node_modules", "@deepseek-ai", "dsh"))
      .filter(existsSync);
  } catch {
    return [];
  }
}

function resolveCliCandidate(candidate: string): DshCli | undefined {
  try {
    const realCandidate = realpathSync(candidate);
    const stats = statSync(realCandidate);
    let packageRoot: string;
    let cliPath: string;
    if (stats.isDirectory()) {
      packageRoot = realCandidate;
      cliPath = path.join(packageRoot, "lib", "bin.js");
    } else {
      cliPath = realCandidate;
      packageRoot = path.dirname(path.dirname(realCandidate));
    }
    if (!existsSync(cliPath)) return undefined;
    const manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
      name?: string;
      version?: string;
    };
    if (manifest.name !== "@deepseek-ai/dsh") return undefined;
    return { path: cliPath, version: manifest.version };
  } catch {
    return undefined;
  }
}

function resolveNodeRuntime(): NodeRuntime | undefined {
  const explicit = process.env.PI_APP_DSH_NODE_PATH?.trim();
  const candidates: NodeRuntime[] = [];
  if (explicit) candidates.push({ path: explicit, electronRunAsNode: false });

  const pathCommand = process.platform === "win32" ? "where" : "which";
  const located = spawnSync(pathCommand, ["node"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (located.status === 0) {
    for (const nodePath of located.stdout.split(/\r?\n/).filter(Boolean)) {
      candidates.push({ path: nodePath, electronRunAsNode: false });
    }
  }
  candidates.push({ path: process.execPath, electronRunAsNode: Boolean(process.versions.electron) });

  return candidates.find((candidate) => {
    if (!existsSync(candidate.path)) return false;
    const env = { ...process.env };
    if (candidate.electronRunAsNode) env.ELECTRON_RUN_AS_NODE = "1";
    const probe = spawnSync(
      candidate.path,
      ["-e", "const m=require('node:module');process.exit(typeof m.stripTypeScriptTypes==='function'?0:1)"],
      { env, stdio: "ignore", timeout: 5_000 },
    );
    return probe.status === 0;
  });
}

function fileMtime(filePath: string): number {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function cleanProcessOutput(output: string): string {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-4)
    .join(" ")
    .slice(0, 800);
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
