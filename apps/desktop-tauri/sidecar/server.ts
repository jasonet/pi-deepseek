/**
 * Node sidecar that hosts the real Electron `DesktopAppStore` behind a
 * newline-delimited JSON-RPC protocol over stdio. The Tauri Rust bridge spawns
 * this process, forwards `pi_invoke(method, args)` requests on stdin, and relays
 * `{kind:"event"}` lines (stateChanged / selectedTranscriptChanged) to the
 * webview. This reuses the exact store + pi runtime the Electron app runs, so we
 * never reimplement pi behavior (per repo CLAUDE.md).
 *
 * Protocol (one JSON object per line):
 *   in  (request): {"id":<number>,"method":<channel-string>,"args":[...]}
 *   out (response): {"kind":"response","id":<number>,"ok":true,"result":<json>}
 *                   {"kind":"response","id":<number>,"ok":false,"error":<string>}
 *   out (event):    {"kind":"event","event":"stateChanged","payload":<state>}
 *                   {"kind":"event","event":"selectedTranscriptChanged","payload":<record|null>}
 *                   {"kind":"event","event":"ready"}
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path, { delimiter as PATH_DELIMITER } from "node:path";
import { createInterface } from "node:readline";

import { DesktopAppStore } from "../../desktop/electron/app-store";
import { desktopIpc } from "../../desktop/src/ipc";
import type {
  ComposerAttachment,
  CreateSessionInput,
  CreateWorktreeInput,
  RemoveWorktreeInput,
  StartThreadInput,
  WorkspaceSessionTarget,
} from "../../desktop/src/desktop-state";

// ---------------------------------------------------------------------------
// stdout is the protocol channel. Anything the store / pi runtime writes via
// console.* must NOT corrupt it, so redirect all console output to stderr and
// keep a private handle to the real stdout writer for framed protocol lines.
// ---------------------------------------------------------------------------
const protocolWrite = (line: string): void => {
  process.stdout.write(line + "\n");
};
for (const level of ["log", "info", "warn", "error", "debug"] as const) {
  console[level] = (...parts: unknown[]) => {
    process.stderr.write(
      parts
        .map((part) => (typeof part === "string" ? part : safeStringify(part)))
        .join(" ") + "\n",
    );
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function emitEvent(event: string, payload?: unknown): void {
  protocolWrite(JSON.stringify({ kind: "event", event, payload }));
}

// ---------------------------------------------------------------------------
// Host helpers that the Electron main process implemented with electron APIs.
// In the sidecar we provide Node-capable equivalents, or safe Checkpoint-1
// stubs where a host capability (dialogs, terminals, updater) isn't wired yet.
// ---------------------------------------------------------------------------
function openPathOrUrl(target: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", target] : [target];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch (error) {
    console.warn("openPathOrUrl failed", target, error);
  }
}

let themeMode: "system" | "light" | "dark" = "system";
const resolvedTheme = (): "light" | "dark" => (themeMode === "dark" ? "dark" : "light");
let composerWorkMode: "pi-agent" | "open-design" = "pi-agent";
let skipAutoTitle = false;
let autoUpdateEnabled = false;

const runtimeLoginCallbacks = {
  onAuth: async ({ url }: { readonly url: string; readonly instructions?: string }) => {
    openPathOrUrl(url);
  },
  onPrompt: async (): Promise<string | null> => null,
};

function emptyTerminalSnapshot(workspaceId: string, terminalScopeId: string) {
  return { workspaceId, rootKey: terminalScopeId, activeSessionId: "", sessions: [] };
}

// ---------------------------------------------------------------------------
// Store bootstrap — mirrors apps/desktop/electron/main.ts store creation.
// ---------------------------------------------------------------------------
function resolveUserDataDir(): string {
  const configured = process.env.PI_APP_USER_DATA_DIR?.trim();
  if (configured) return configured;
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  if (process.platform === "darwin") {
    return `${home}/Library/Application Support/pi-deepseek`;
  }
  if (process.platform === "win32") {
    return `${process.env.APPDATA ?? home}/pi-deepseek`;
  }
  return `${process.env.XDG_CONFIG_HOME ?? `${home}/.config`}/pi-deepseek`;
}

function resolveInitialWorkspacePaths(): readonly string[] {
  const raw = process.env.PI_APP_INITIAL_WORKSPACES;
  if (raw === undefined) return [];
  return raw
    .split(PATH_DELIMITER)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const store = new DesktopAppStore({
  userDataDir: resolveUserDataDir(),
  initialWorkspacePaths: resolveInitialWorkspacePaths(),
  getWindow: () => null,
  generateThreadTitleOverride: async () => {
    if (skipAutoTitle) return null;
    return undefined;
  },
});

// ---------------------------------------------------------------------------
// Open Design (pi-open-design) status + install. Ported from
// apps/desktop/electron/main.ts. The sidecar has no Electron app paths, so we
// derive the home directory from os.homedir() and scan workspace paths instead
// of process.cwd() (the sidecar is spawned with cwd "/").
// ---------------------------------------------------------------------------
const OPEN_DESIGN_EXTENSION_ID = "pi-open-design";
const OPEN_DESIGN_DEFAULT_DAEMON_URL = "http://127.0.0.1:7456";
const OPEN_DESIGN_DEFAULT_WEB_URL = "http://127.0.0.1:7456";

interface OpenDesignConfig {
  readonly daemonUrl: string;
  readonly webUrl: string;
  readonly extensionRoot?: string;
  readonly searchedExtensionRoots: readonly string[];
}

interface OpenDesignStatus {
  readonly daemonUrl: string;
  readonly webUrl: string;
  readonly reachable: boolean;
  readonly daemonReachable?: boolean;
  readonly webReachable?: boolean;
  readonly version?: string;
  readonly message?: string;
}

function openDesignExtensionRootCandidates(): Set<string> {
  const roots = new Set<string>();
  const extensionRoots = new Set<string>();

  const addRoot = (root: string | undefined) => {
    if (!root) return;
    let current = path.resolve(root);
    for (let depth = 0; depth < 8 && !roots.has(current); depth += 1) {
      roots.add(current);
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  };

  const addExtensionRoot = (root: string | undefined) => {
    if (root) extensionRoots.add(path.resolve(root));
  };

  addExtensionRoot(process.env.OPEN_DESIGN_EXTENSION_ROOT?.trim());
  // Scan known workspace paths (sidecar cwd is "/", so process.cwd() is useless).
  try {
    for (const workspace of store.getState().workspaces) {
      if (workspace.path) addRoot(workspace.path);
    }
  } catch {
    // Store may not be ready; fall through to home-dir candidate.
  }
  addRoot(process.cwd());

  for (const root of roots) {
    addExtensionRoot(path.join(root, ".pi", "extensions", OPEN_DESIGN_EXTENSION_ID));
  }
  addExtensionRoot(path.join(homedir(), ".pi", "extensions", OPEN_DESIGN_EXTENSION_ID));

  return extensionRoots;
}

async function readOpenDesignConfig(): Promise<OpenDesignConfig> {
  const envDaemonUrl = process.env.OPEN_DESIGN_DAEMON_URL?.trim();
  const envWebUrl = process.env.OPEN_DESIGN_WEB_URL?.trim();
  let daemonUrl = envDaemonUrl || OPEN_DESIGN_DEFAULT_DAEMON_URL;
  let webUrl = envWebUrl || OPEN_DESIGN_DEFAULT_WEB_URL;
  let extensionRoot: string | undefined;
  const extensionRoots = openDesignExtensionRootCandidates();

  for (const candidateRoot of extensionRoots) {
    const manifestPath = path.join(candidateRoot, "open-design.manifest.json");
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        daemon?: { defaultUrl?: string; defaultWebUrl?: string };
      };
      daemonUrl = envDaemonUrl || manifest.daemon?.defaultUrl || daemonUrl;
      webUrl = envWebUrl || manifest.daemon?.defaultWebUrl || webUrl;
      extensionRoot = candidateRoot;
      break;
    } catch {
      // Keep scanning plausible dev/package roots.
    }
  }

  return { daemonUrl, webUrl, extensionRoot, searchedExtensionRoots: [...extensionRoots] };
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 3000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOpenDesignJson(url: string): Promise<unknown> {
  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function isOpenDesignWebReachable(url: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(url, { method: "HEAD" }, 5000);
    return response.status >= 200 && response.status < 400;
  } catch {
    try {
      const response = await fetchWithTimeout(url, { method: "GET" }, 5000);
      return response.status >= 200 && response.status < 400;
    } catch {
      return false;
    }
  }
}

async function getOpenDesignStatus(): Promise<OpenDesignStatus> {
  const config = await readOpenDesignConfig();
  let daemonReachable = false;
  let daemonMessage = "";
  let version: string | undefined;

  try {
    await fetchOpenDesignJson(`${config.daemonUrl}/api/health`);
    daemonReachable = true;
    try {
      const versionResponse = (await fetchOpenDesignJson(`${config.daemonUrl}/api/version`)) as {
        version?: unknown;
        openDesignVersion?: unknown;
      };
      const nestedVersion =
        typeof versionResponse.version === "object" && versionResponse.version !== null
          ? (versionResponse.version as { version?: unknown }).version
          : undefined;
      version =
        typeof versionResponse.version === "string"
          ? versionResponse.version
          : typeof nestedVersion === "string"
            ? nestedVersion
            : typeof versionResponse.openDesignVersion === "string"
              ? versionResponse.openDesignVersion
              : undefined;
    } catch {
      version = undefined;
    }
  } catch (error) {
    daemonMessage = error instanceof Error ? error.message : String(error);
  }

  const webReachable = await isOpenDesignWebReachable(config.webUrl);
  return {
    daemonUrl: config.daemonUrl,
    webUrl: config.webUrl,
    reachable: daemonReachable,
    daemonReachable,
    webReachable,
    version,
    message: daemonReachable ? undefined : daemonMessage,
  };
}

function resolveOpenDesignRepoRoot(): string | undefined {
  const envRoot = process.env.OPEN_DESIGN_ROOT?.trim();
  const candidates = [
    envRoot,
    path.join(homedir(), "Sites", "Github", "open-design"),
    path.join(homedir(), ".pi", "open-design", "repo"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
  }
  return undefined;
}

function pnpmCommand(): string {
  const envBin = process.env.OPEN_DESIGN_PNPM_BIN?.trim();
  if (envBin) return envBin;
  // On Windows the executable is the cmd shim; runCommand uses shell:true there
  // so PATH resolution + .cmd extension are handled by the shell.
  if (process.platform === "win32") return "pnpm";
  for (const candidate of [
    "/opt/homebrew/bin/pnpm",
    path.join(homedir(), ".bun", "bin", "pnpm"),
    "/usr/local/bin/pnpm",
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return "pnpm";
}

// Async spawn wrapper so a long-running pnpm install does not block the sidecar
// event loop (which would freeze the whole UI, unlike Electron's separate main
// process). Resolves with the exit code; rejects only on spawn failure.
function runCommand(
  command: string,
  args: readonly string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      env: { ...process.env },
    });
    let stderr = "";
    child.stdout?.on("data", (chunk) => process.stderr.write(chunk));
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
      process.stderr.write(chunk);
    });
    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(`${command} timed out after ${options.timeoutMs}ms`));
        }, options.timeoutMs)
      : undefined;
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 0, stderr });
    });
  });
}

async function installOpenDesign(): Promise<{ ok: boolean; message: string }> {
  const root = resolveOpenDesignRepoRoot();
  if (!root) {
    return {
      ok: false,
      message:
        "open-design repo not found. Clone it to ~/Sites/Github/open-design or set OPEN_DESIGN_ROOT to its path.",
    };
  }
  const pnpm = pnpmCommand();
  try {
    const install = await runCommand(pnpm, ["install"], { cwd: root, timeoutMs: 300_000 });
    if (install.code !== 0) {
      return { ok: false, message: `pnpm install failed (exit ${install.code}). ${install.stderr.slice(-400)}` };
    }
    const rebuild = await runCommand(pnpm, ["rebuild", "better-sqlite3"], { cwd: root, timeoutMs: 120_000 });
    if (rebuild.code !== 0) {
      return {
        ok: false,
        message: `pnpm rebuild better-sqlite3 failed (exit ${rebuild.code}). ${rebuild.stderr.slice(-400)}`,
      };
    }
    return { ok: true, message: "Dependencies installed & rebuilt. Restart the daemon to apply." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

// ---------------------------------------------------------------------------
// Method dispatch table — keyed by the desktopIpc channel string, mirroring the
// ipcMain.handle wiring in apps/desktop/electron/main.ts.
// ---------------------------------------------------------------------------
type Handler = (...args: any[]) => unknown | Promise<unknown>;

const handlers: Record<string, Handler> = {
  [desktopIpc.ping]: () => "pi desktop ready",
  [desktopIpc.getThemeMode]: () => themeMode,
  [desktopIpc.getResolvedTheme]: () => resolvedTheme(),
  [desktopIpc.setThemeMode]: (mode: "system" | "light" | "dark") => {
    themeMode = mode;
    emitEvent("themeChanged", resolvedTheme());
    return mode;
  },
  [desktopIpc.openExternal]: (url: string) => {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`Refusing to open unsupported URL: ${url}`);
    }
    openPathOrUrl(url);
  },
  [desktopIpc.getOpenDesignStatus]: () => getOpenDesignStatus(),
  [desktopIpc.installOpenDesign]: () => installOpenDesign(),
  [desktopIpc.stateRequest]: () => store.getState(),
  [desktopIpc.selectedTranscriptRequest]: () => store.getSelectedTranscript(),
  [desktopIpc.addWorkspacePath]: (workspacePath: string) => store.addWorkspace(workspacePath),
  [desktopIpc.pickWorkspace]: () => store.getState(),
  [desktopIpc.selectWorkspace]: (workspaceId: string) => store.selectWorkspace(workspaceId),
  [desktopIpc.renameWorkspace]: (workspaceId: string, displayName: string) =>
    store.renameWorkspace(workspaceId, displayName),
  [desktopIpc.removeWorkspace]: (workspaceId: string) => store.removeWorkspace(workspaceId),
  [desktopIpc.reorderWorkspaces]: (order: readonly string[]) => store.reorderWorkspaces(order),
  [desktopIpc.openWorkspaceInFinder]: (workspaceId: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) throw new Error(`Unknown workspace: ${workspaceId}`);
    openPathOrUrl(workspacePath);
  },
  [desktopIpc.createWorktree]: (input: CreateWorktreeInput) => store.createWorktree(input),
  [desktopIpc.removeWorktree]: (input: RemoveWorktreeInput) => store.removeWorktree(input),
  [desktopIpc.syncCurrentWorkspace]: () => store.syncCurrentWorkspace(),
  [desktopIpc.selectSession]: (target: WorkspaceSessionTarget) => store.selectSession(target),
  [desktopIpc.archiveSession]: (target: WorkspaceSessionTarget) => store.archiveSession(target),
  [desktopIpc.unarchiveSession]: (target: WorkspaceSessionTarget) => store.unarchiveSession(target),
  [desktopIpc.setActiveView]: (activeView: any) => store.setActiveView(activeView),
  [desktopIpc.setSidebarCollapsed]: (collapsed: boolean) => store.setSidebarCollapsed(collapsed),
  [desktopIpc.setWorkspaceCollapsed]: (workspaceId: string, collapsed: boolean) =>
    store.setWorkspaceCollapsed(workspaceId, collapsed),
  [desktopIpc.setArchivedSectionExpanded]: (workspaceId: string, expanded: boolean) =>
    store.setArchivedSectionExpanded(workspaceId, expanded),
  [desktopIpc.refreshRuntime]: (workspaceId?: string) => store.refreshRuntime(workspaceId),
  [desktopIpc.setModelSettingsScopeMode]: (mode: any) => store.setModelSettingsScopeMode(mode),
  [desktopIpc.setSessionModel]: (workspaceId: string, sessionId: string, provider: string, modelId: string) =>
    store.setSessionModel({ workspaceId, sessionId }, provider, modelId),
  [desktopIpc.setDefaultModel]: (workspaceId: string, provider: string, modelId: string) =>
    store.setDefaultModel(workspaceId, provider, modelId),
  [desktopIpc.setDefaultThinkingLevel]: (workspaceId: string, thinkingLevel: any) =>
    store.setDefaultThinkingLevel(workspaceId, thinkingLevel),
  [desktopIpc.setSessionThinkingLevel]: (workspaceId: string, sessionId: string, thinkingLevel: any) =>
    store.setSessionThinkingLevel({ workspaceId, sessionId }, thinkingLevel),
  [desktopIpc.loginProvider]: (workspaceId: string, providerId: string) =>
    store.loginProvider(workspaceId, providerId, runtimeLoginCallbacks),
  [desktopIpc.logoutProvider]: (workspaceId: string, providerId: string) =>
    store.logoutProvider(workspaceId, providerId),
  [desktopIpc.setProviderApiKey]: (workspaceId: string, providerId: string, apiKey: string) =>
    store.setProviderApiKey(workspaceId, providerId, apiKey),
  [desktopIpc.setEnableSkillCommands]: (workspaceId: string, enabled: boolean) =>
    store.setEnableSkillCommands(workspaceId, enabled),
  [desktopIpc.setScopedModelPatterns]: (workspaceId: string, patterns: readonly string[]) =>
    store.setScopedModelPatterns(workspaceId, patterns),
  [desktopIpc.setSkillEnabled]: (workspaceId: string, filePath: string, enabled: boolean) =>
    store.setSkillEnabled(workspaceId, filePath, enabled),
  [desktopIpc.setExtensionEnabled]: (workspaceId: string, filePath: string, enabled: boolean) =>
    store.setExtensionEnabled(workspaceId, filePath, enabled),
  [desktopIpc.respondToHostUiRequest]: (workspaceId: string, sessionId: string, response: any) =>
    store.respondToHostUiRequest({ workspaceId, sessionId }, response),
  [desktopIpc.setNotificationPreferences]: (preferences: any) => store.setNotificationPreferences(preferences),
  [desktopIpc.saveImChannel]: (input: any) => store.saveImChannel(input),
  [desktopIpc.removeImChannel]: (channelId: string) => store.removeImChannel(channelId),
  [desktopIpc.updateImChannelSession]: (provider: any, sessionId: string) =>
    store.updateImChannelSession(provider, sessionId),
  [desktopIpc.startConnectPhoneQr]: () => ({ ok: false, message: "暂不支持该连接方式。" }),
  [desktopIpc.pollConnectPhoneQr]: () => ({ done: false, message: "暂不支持该连接方式。" }),
  [desktopIpc.setIntegratedTerminalShell]: (shellPath: string) => store.setIntegratedTerminalShell(shellPath),
  [desktopIpc.setEnableTransparency]: (enabled: boolean) => store.setEnableTransparency(enabled),
  [desktopIpc.setLocale]: (locale: string) => store.setLocale(locale),
  [desktopIpc.getLocale]: () => store.getLocale(),
  [desktopIpc.getProviderBalance]: async (providerId: string) => {
    try {
      const auth = store.getProviderAuth(providerId);
      if (!auth) return { error: "No auth configured" };
      const resp = await fetch("https://api.deepseek.com/user/balance", {
        headers: { Authorization: `Bearer ${auth}` },
      });
      if (!resp.ok) return { error: `API error ${resp.status}` };
      const data = (await resp.json()) as any;
      const bal = data?.balance_infos?.[0]?.total_balance ?? data?.data?.balance ?? "?";
      return { balance: String(bal) };
    } catch (error: any) {
      return { error: error?.message ?? String(error) };
    }
  },
  [desktopIpc.checkForUpdate]: () => ({ status: "dev" }),
  [desktopIpc.downloadUpdate]: () => ({ status: "dev" }),
  [desktopIpc.installUpdate]: () => undefined,
  [desktopIpc.setAutoUpdateEnabled]: (enabled: boolean) => {
    autoUpdateEnabled = enabled;
    return enabled;
  },
  [desktopIpc.getAutoUpdateEnabled]: () => autoUpdateEnabled,
  [desktopIpc.setSkipAutoTitle]: (skip: boolean) => {
    skipAutoTitle = skip;
    return skip;
  },
  [desktopIpc.setComposerWorkMode]: (mode: string) => {
    composerWorkMode = mode === "open-design" ? "open-design" : "pi-agent";
    return store.emit();
  },
  [desktopIpc.getComposerWorkMode]: () => composerWorkMode,
  [desktopIpc.terminalEnsurePanel]: (workspaceId: string, terminalScopeId: string) =>
    emptyTerminalSnapshot(workspaceId, terminalScopeId),
  [desktopIpc.terminalCreateSession]: (workspaceId: string, terminalScopeId: string) =>
    emptyTerminalSnapshot(workspaceId, terminalScopeId),
  [desktopIpc.terminalSetActiveSession]: (workspaceId: string, terminalScopeId: string) =>
    emptyTerminalSnapshot(workspaceId, terminalScopeId),
  [desktopIpc.terminalWrite]: () => undefined,
  [desktopIpc.terminalResize]: () => undefined,
  [desktopIpc.terminalRestartSession]: () => {
    throw new Error("Integrated terminal is not available in this build");
  },
  [desktopIpc.terminalCloseSession]: () => null,
  [desktopIpc.terminalSetTitle]: () => undefined,
  [desktopIpc.getNotificationPermissionStatus]: () => "unknown",
  [desktopIpc.requestNotificationPermission]: () => "unknown",
  [desktopIpc.openSystemNotificationSettings]: () => undefined,
  [desktopIpc.createSession]: (input: CreateSessionInput) => store.createSession(input),
  [desktopIpc.startThread]: (input: StartThreadInput) => store.startThread(input),
  [desktopIpc.openSkillInFinder]: (workspaceId: string, filePath: string) => {
    const resolved = store.getSkillFilePath(workspaceId, filePath);
    if (!resolved) throw new Error(`Unknown skill: ${filePath}`);
    openPathOrUrl(resolved);
  },
  [desktopIpc.openExtensionInFinder]: (workspaceId: string, filePath: string) => {
    const resolved = store.getExtensionFilePath(workspaceId, filePath);
    if (!resolved) throw new Error(`Unknown extension: ${filePath}`);
    openPathOrUrl(resolved);
  },
  [desktopIpc.cancelCurrentRun]: () => store.cancelCurrentRun(),
  [desktopIpc.pickComposerAttachments]: () => store.getState(),
  [desktopIpc.readClipboardImage]: () => null,
  [desktopIpc.addComposerAttachments]: (attachments: readonly ComposerAttachment[]) =>
    store.addComposerAttachments(attachments),
  [desktopIpc.removeComposerAttachment]: (attachmentId: string) => store.removeComposerAttachment(attachmentId),
  [desktopIpc.editQueuedComposerMessage]: (messageId: string, currentDraft?: string) =>
    store.editQueuedComposerMessage(messageId, currentDraft),
  [desktopIpc.cancelQueuedComposerEdit]: () => store.cancelQueuedComposerEdit(),
  [desktopIpc.removeQueuedComposerMessage]: (messageId: string) => store.removeQueuedComposerMessage(messageId),
  [desktopIpc.steerQueuedComposerMessage]: (messageId: string) => store.steerQueuedComposerMessage(messageId),
  [desktopIpc.updateComposerDraft]: (composerDraft: string) => store.updateComposerDraft(composerDraft),
  [desktopIpc.submitComposer]: (text: string, options?: { readonly deliverAs?: "steer" | "followUp" }) =>
    store.submitComposer(text, options),
  [desktopIpc.getSessionTree]: (target: WorkspaceSessionTarget) => store.getSessionTree(target),
  [desktopIpc.navigateSessionTree]: (target: WorkspaceSessionTarget, targetId: string, options?: any) =>
    store.navigateSessionTree(target, targetId, options),
  [desktopIpc.listWorkspaceFiles]: async (workspaceId: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) return [];
    const { listWorkspaceFiles } = await import("../../desktop/electron/app-store-files");
    return listWorkspaceFiles(workspacePath);
  },
  [desktopIpc.getChangedFiles]: async (workspaceId: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) return [];
    const { getChangedFiles } = await import("../../desktop/electron/app-store-diff");
    return getChangedFiles(workspacePath);
  },
  [desktopIpc.getFileDiff]: async (workspaceId: string, filePath: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) return "";
    const { getFileDiff } = await import("../../desktop/electron/app-store-diff");
    return getFileDiff(workspacePath, filePath);
  },
  [desktopIpc.stageFile]: async (workspaceId: string, filePath: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) throw new Error(`Unknown workspace: ${workspaceId}`);
    const { stageFile } = await import("../../desktop/electron/app-store-diff");
    await stageFile(workspacePath, filePath);
  },
  [desktopIpc.toggleWindowMaximize]: () => undefined,
};

async function dispatch(method: string, args: unknown[]): Promise<unknown> {
  const handler = handlers[method];
  if (!handler) {
    throw new Error(`Unknown method: ${method}`);
  }
  return handler(...args);
}

// ---------------------------------------------------------------------------
// stdin request loop.
// ---------------------------------------------------------------------------
async function handleLine(line: string): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;
  let request: { id?: number; method?: string; args?: unknown[] };
  try {
    request = JSON.parse(trimmed);
  } catch (error) {
    console.warn("sidecar: dropped malformed request line", error);
    return;
  }
  const { id, method, args } = request;
  if (typeof id !== "number" || typeof method !== "string") {
    console.warn("sidecar: dropped request missing id/method");
    return;
  }
  // Lightweight request trace (stderr only) — helps diagnose duplicate calls
  // such as a single user action producing two startThread/createSession calls.
  console.log(`[rpc] #${id} ${method}`);
  try {
    const result = await dispatch(method, Array.isArray(args) ? args : []);
    protocolWrite(JSON.stringify({ kind: "response", id, ok: true, result: result ?? null }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    protocolWrite(JSON.stringify({ kind: "response", id, ok: false, error: message }));
  }
}

async function main(): Promise<void> {
  await store.initialize();

  // Wire state publishers, mirroring main.ts attachStatePublisher.
  store.subscribe((state) => emitEvent("stateChanged", state));
  store.subscribeToSelectedTranscript((payload) => {
    if (!payload) return;
    let next = payload;
    const len = payload.transcript?.length ?? 0;
    if (len > 150) {
      next = { ...payload, transcript: payload.transcript.slice(-150) };
    }
    emitEvent("selectedTranscriptChanged", next);
  });

  emitEvent("ready");

  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    void handleLine(line);
  });
  rl.on("close", () => {
    process.exit(0);
  });
}

void main().catch((error) => {
  console.error("sidecar fatal", error);
  process.exit(1);
});
