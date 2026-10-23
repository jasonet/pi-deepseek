import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { StringDecoder } from "node:string_decoder";
import lockfile from "proper-lockfile";
import type { DshWebProgress } from "../src/ipc";
import { applyPojiaDsh, POJIA_REVISION, verifyPojiaDsh } from "./pojia-dsh";

export const DSH_VERSION = "0.2.1-alpha.1";
const NODE_VERSION = "24.22.1";
const NODE_HASHES: Record<string, string> = {
  "darwin-arm64": "89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7",
  "darwin-x64": "d132557e7ee2b85af08b0c8c34338e65c6430f2238d01f727728ef42dc83b035",
  "linux-arm64": "33c37be234ba8bee041961047b19160f4d7d0f164e8e246f78bdd10feff148b3",
  "linux-x64": "eb6728e77c576a35162c122c45ccadf224d89ff00abc8dae46cc2897c6002d7c",
  "win32-arm64": "a0c807319fede24c4a0d8f84564c82a619bd313b16b10c007c383c2609e99171",
  "win32-x64": "d2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5",
};

export interface DshRuntime {
  readonly node: string;
  readonly cli: string;
}
export type DshInstallReporter = (update: DshWebProgress & { readonly line?: string }) => void;

// Parse complete UTF-8 lines before inspecting URLs or redacting credentials across chunk boundaries.
export function dshOutputLines(onLine: (line: string) => void): (chunk: Buffer) => void {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let dropping = false;
  return (chunk) => {
    const parts = decoder.write(chunk).split(/\r?\n/);
    for (let index = 0; index < parts.length; index++) {
      if (!dropping) pending += parts[index];
      if (pending.length > 16_000) { pending = ""; dropping = true; }
      if (index < parts.length - 1) {
        if (!dropping && pending) onLine(pending);
        pending = "";
        dropping = false;
      }
    }
  };
}

export function dshEnvironment(node: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${dirname(node)}${delimiter}${process.env.PATH ?? ""}` };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  delete env.DEEPSEEK_API_KEY;
  return env;
}

export function sanitizeDshLog(text: string): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/(https?:\/\/)[^/\s@]+@/gi, "$1[redacted]@")
    .replace(/([?&]token=)[^\s&#]+/gi, "$1[redacted]")
    .replace(/\bsk-[\w-]+/g, "[redacted]")
    .replace(/((?:api[_-]?key|authorization|password)\s*[:=]\s*)(?:(?:Bearer|Basic)\s+)?\S+/gi, "$1[redacted]")
    .slice(0, 600);
}

export async function stopDshProcess(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  const pid = child.pid;
  if (process.platform === "win32") {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
      killer.once("error", () => resolve());
      killer.once("exit", () => resolve());
    });
    return;
  }
  const signalGroup = (signal: NodeJS.Signals) => {
    try { process.kill(-pid, signal); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  signalGroup("SIGTERM");
  // Wait on the process group, including npm/DSH descendants after their parent exits.
  for (let i = 0; i < 30; i++) {
    try { process.kill(-pid, 0); } catch { return; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  signalGroup("SIGKILL");
}

async function runInstaller(command: string, args: string[], signal: AbortSignal, report: DshInstallReporter, env?: NodeJS.ProcessEnv): Promise<void> {
  signal.throwIfAborted();
  const child = spawn(command, args, { env, detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let tail = "";
  const onLine = (line: string) => {
    const safe = sanitizeDshLog(line);
    tail = (tail + "\n" + safe).slice(-4000);
    report({ line: safe });
  };
  child.stdout?.on("data", dshOutputLines(onLine));
  child.stderr?.on("data", dshOutputLines(onLine));
  const abort = () => { void stopDshProcess(child).catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`安装进程退出 (${code}): ${tail.slice(-600)}`)));
      if (signal.aborted) abort();
    });
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener("abort", abort);
    if (signal.aborted) await stopDshProcess(child);
  }
}

export async function ensureDshRuntime(root: string, signal: AbortSignal, report: DshInstallReporter): Promise<DshRuntime> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lockController = new AbortController();
  const release = await lockfile.lock(root, {
    stale: 30_000, retries: { retries: 0 }, onCompromised: (error) => lockController.abort(error),
  });
  const boundedSignal = AbortSignal.any([signal, lockController.signal, AbortSignal.timeout(15 * 60_000)]);
  try {
    boundedSignal.throwIfAborted();
    const platform = process.platform;
    const hash = NODE_HASHES[`${platform}-${process.arch}`];
    if (!hash) throw new Error(`不支持此平台: ${platform}-${process.arch}`);
    const basename = `node-v${NODE_VERSION}-${platform === "win32" ? "win" : platform}-${process.arch}`;
    const nodeRoot = join(root, basename);
    const node = join(nodeRoot, platform === "win32" ? "node.exe" : "bin/node");
    const npmRelative = platform === "win32" ? "node_modules/npm/bin/npm-cli.js" : "lib/node_modules/npm/bin/npm-cli.js";
    const nodeReceipt = join(nodeRoot, "taosi-runtime.sha256");
    report({ phase: "runtime", line: `检查 Node.js ${NODE_VERSION}` });
    const readyNode = await readFile(nodeReceipt, "utf8").then((receipt) => receipt === hash, () => false)
      && await access(node).then(() => true, () => false)
      && await access(join(nodeRoot, npmRelative)).then(() => true, () => false);
    if (!readyNode) {
      const staging = join(root, `install-node-${randomUUID()}`);
      await mkdir(staging, { mode: 0o700 });
      const archive = `${basename}.${platform === "win32" ? "zip" : "tar.gz"}`;
      const response = await fetch(`https://nodejs.org/dist/v${NODE_VERSION}/${archive}`, { signal: boundedSignal });
      if (!response.ok || !response.body) throw new Error(`Node.js 下载失败: HTTP ${response.status}`);
      const total = Number(response.headers.get("content-length"));
      const digest = createHash("sha256");
      let received = 0;
      let lastProgress = -1;
      const meter = new Transform({ transform(chunk, _encoding, callback) {
        digest.update(chunk);
        received += chunk.length;
        const progress = total > 0 ? Math.min(100, Math.floor(received * 100 / total)) : undefined;
        if (progress !== lastProgress) {
          report({ phase: "runtime", progress });
          lastProgress = progress ?? -1;
        }
        callback(null, chunk);
      } });
      const archivePath = join(staging, archive);
      await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), meter, createWriteStream(archivePath, { flags: "wx", mode: 0o600 }), { signal: boundedSignal });
      if (digest.digest("hex") !== hash) throw new Error("Node.js 下载校验失败，请重试。");
      report({ phase: "runtime", progress: undefined, line: "SHA-256 校验通过，正在解压运行环境" });
      await runInstaller("tar", ["-xf", archivePath, "-C", staging], boundedSignal, report);
      await writeFile(join(staging, basename, "taosi-runtime.sha256"), hash, { mode: 0o600 });
      if (await access(nodeRoot).then(() => true, () => false)) await rename(nodeRoot, `${nodeRoot}-backup-${randomUUID()}`);
      await rename(join(staging, basename), nodeRoot);
    }
    const runtimeRoot = join(root, `dsh-${DSH_VERSION}-pojia-${POJIA_REVISION}`);
    const cliRelative = "node_modules/@deepseek-ai/dsh/lib/bin.js";
    if (await verifyPojiaDsh(runtimeRoot) && await access(join(runtimeRoot, cliRelative)).then(() => true, () => false)) {
      report({ phase: "pojia", line: "Pojia Harness 安装校验通过" });
      return { node, cli: join(runtimeRoot, cliRelative) };
    }
    const staging = join(root, `install-dsh-${randomUUID()}`);
    await mkdir(staging, { mode: 0o700 });
    await writeFile(join(staging, "package.json"), JSON.stringify({
      private: true, name: "taosi-managed-harness", version: "1.0.0",
      allowScripts: {
        [`@deepseek-ai/dsh-subprocess-local@${DSH_VERSION}`]: true,
        "koffi@3.1.1": true, "node-pty@1.2.0-beta.15": true,
        "@google/genai": false, "protobufjs": false,
      },
      overrides: { koffi: "3.1.1", "node-pty": "1.2.0-beta.15" },
    }));
    report({ phase: "dependencies", progress: undefined, line: `安装 DeepSeek Harness ${DSH_VERSION}` });
    const npm = join(nodeRoot, npmRelative);
    await runInstaller(node, [npm, "install", "--prefix", staging, "--strict-allow-scripts", "--no-audit", "--no-fund", "--progress=false", "--loglevel=http", `@deepseek-ai/dsh@${DSH_VERSION}`], boundedSignal, report, dshEnvironment(node));
    boundedSignal.throwIfAborted();
    report({ phase: "pojia", progress: undefined, line: "应用 Pojia DSH 指令与 persona，保留原始文件备份" });
    await applyPojiaDsh(staging);
    boundedSignal.throwIfAborted();
    // Preserve a damaged installation for diagnosis instead of silently overwriting it.
    if (await access(runtimeRoot).then(() => true, () => false)) await rename(runtimeRoot, `${runtimeRoot}-backup-${randomUUID()}`);
    await rename(staging, runtimeRoot);
    return { node, cli: join(runtimeRoot, cliRelative) };
  } finally {
    await release();
  }
}
