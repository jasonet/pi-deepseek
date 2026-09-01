import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const releaseDir = path.resolve(desktopDir, process.env.PI_APP_FIRST_RUN_RELEASE_DIR?.trim() || "release");
const executablePath = process.env.PI_APP_FIRST_RUN_EXECUTABLE?.trim() || resolvePackagedExecutable(releaseDir);
const userDataDir = mkdtempSync(path.join(tmpdir(), "pi-first-run-user-data-"));
const agentDir = path.join(userDataDir, "agent");
mkdirSync(agentDir, { recursive: true });
const childEnv = createIsolatedEnvironment(userDataDir, agentDir);

await assertPortAvailable("http://127.0.0.1:8789/im/health", "IM webhook 8789");
await assertPortAvailable("http://127.0.0.1:18790/health", "WeChat bridge RPC 18790");

let stdout = "";
let stderr = "";
let exitCode;
// GitHub Actions / container runners lack SUID chrome-sandbox, so Electron's
// Chromium sandbox aborts at startup. Disable it for the smoke on Linux (CI
// containers); macOS/Windows spawn normally.
const spawnArgs = process.platform === "linux" ? ["--no-sandbox"] : [];
const child = spawn(executablePath, spawnArgs, {
  cwd: path.dirname(executablePath),
  env: childEnv,
});

child.stdout.on("data", (chunk) => {
  stdout += chunk;
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});
child.once("exit", (code) => {
  exitCode = code;
});

try {
  // First-run extension extraction and platform security scans can both delay startup.
  const healthTimeoutMs = 60_000;
  await waitFor(() => exitCode !== undefined || healthOk("http://127.0.0.1:8789/im/health"), healthTimeoutMs);
  if (exitCode !== undefined) {
    throw new Error(`Packaged app exited during first-run smoke with code ${exitCode}.`);
  }
  await waitFor(() => healthOk("http://127.0.0.1:18790/health"), healthTimeoutMs);
  if (/Uncaught Exception|ERR_MODULE_NOT_FOUND|Cannot find package/i.test(stderr)) {
    throw new Error(`Packaged app stderr contains a startup exception:\n${stderr}`);
  }

  console.log(JSON.stringify({
    ok: true,
    executablePath,
    userDataDir,
    pid: child.pid,
    imWebhook: "http://127.0.0.1:8789/im/health",
    weixinRpc: "http://127.0.0.1:18790/health",
    stdout: redactSecrets(stdout.trim().slice(-1000)),
    stderr: redactSecrets(stderr.trim().slice(-1000)),
    logs: readLogPreview(userDataDir).map(({ fileName, tail }) => ({
      fileName,
      tail: redactSecrets(tail),
    })),
  }, null, 2));
} finally {
  if (exitCode === undefined) {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
  }
}
process.exit(0);

function resolvePackagedExecutable(releaseDir) {
  if (process.platform === "darwin") {
    const preferredDir = process.arch === "arm64" ? "mac-arm64" : "mac";
    const candidates = [
      path.join(releaseDir, preferredDir, "Taosi.app"),
      path.join(releaseDir, "mac-arm64", "Taosi.app"),
      path.join(releaseDir, "mac", "Taosi.app"),
    ];
    const appBundle = candidates.find((candidate) => existsSync(candidate));
    if (!appBundle) {
      throw new Error(`No Taosi.app bundle found under ${releaseDir}.`);
    }
    return resolveMacExecutable(appBundle);
  }

  if (process.platform === "linux") {
    const unpackedDir = readdirSync(releaseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^linux(?:-[\w]+)?-unpacked$/.test(entry.name))
      .map((entry) => path.join(releaseDir, entry.name))
      .find((candidate) => existsSync(path.join(candidate, "taosi")));
    if (!unpackedDir) {
      throw new Error(`No linux-unpacked Taosi executable found under ${releaseDir}.`);
    }
    return path.join(unpackedDir, "taosi");
  }

  if (process.platform === "win32") {
    const unpackedDir = path.join(releaseDir, "win-unpacked");
    const executable = path.join(unpackedDir, "Taosi.exe");
    if (!existsSync(executable)) {
      throw new Error(`No Windows Taosi.exe found at ${executable}.`);
    }
    return executable;
  }

  throw new Error(`Unsupported first-run smoke platform: ${process.platform}`);
}

function resolveMacExecutable(appBundle) {
  const macOsDir = path.join(appBundle, "Contents", "MacOS");
  const expectedName = path.basename(appBundle, ".app");
  const entries = readdirSync(macOsDir, { withFileTypes: true });
  const entry = entries.find((candidate) => candidate.isFile() && candidate.name === expectedName) ??
    entries.find((candidate) => candidate.isFile());
  if (!entry) {
    throw new Error(`No executable found under ${macOsDir}.`);
  }
  return path.join(macOsDir, entry.name);
}

function createIsolatedEnvironment(baseDir, isolatedAgentDir) {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !isSensitiveEnvironmentName(name)),
  );
  const configDir = path.join(baseDir, "config");
  const cacheDir = path.join(baseDir, "cache");
  const dataDir = path.join(baseDir, "data");
  for (const directory of [configDir, cacheDir, dataDir]) {
    mkdirSync(directory, { recursive: true });
  }

  return {
    ...environment,
    HOME: baseDir,
    USERPROFILE: baseDir,
    APPDATA: configDir,
    LOCALAPPDATA: dataDir,
    XDG_CONFIG_HOME: configDir,
    XDG_CACHE_HOME: cacheDir,
    XDG_DATA_HOME: dataDir,
    PI_APP_USER_DATA_DIR: baseDir,
    PI_CODING_AGENT_DIR: isolatedAgentDir,
    PI_APP_INITIAL_WORKSPACES: "",
    PI_APP_TEST_MODE: "background",
    PI_APP_OPEN_DEVTOOLS: "0",
  };
}

function isSensitiveEnvironmentName(name) {
  return /(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_?KEY|CREDENTIAL)/i.test(name);
}

function redactSecrets(value) {
  return value
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_API_KEY]");
}

async function assertPortAvailable(url, label) {
  if (await healthOk(url)) {
    throw new Error(`${label} already responds before launch; close existing Taosi/Kun instances before first-run smoke.`);
  }
}

async function healthOk(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out after ${timeoutMs}ms.`);
}

function readLogPreview(baseDir) {
  const logsDir = path.join(baseDir, "logs");
  if (!existsSync(logsDir)) {
    return [];
  }
  return readdirSync(logsDir)
    .slice(0, 5)
    .map((fileName) => ({
      fileName,
      tail: readFileSync(path.join(logsDir, fileName), "utf8").slice(-1200),
    }));
}
