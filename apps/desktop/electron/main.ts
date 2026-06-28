import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  shell,
  type MenuItemConstructorOptions,
  type MessageBoxOptions,
} from "electron";
import { randomUUID } from "node:crypto";
import { execSync, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DesktopAppStore } from "./app-store";
import { getChangedFiles, getFileDiff, stageFile } from "./app-store-diff";
import { listWorkspaceFiles } from "./app-store-files";
import { MAIN_DEV_RELOAD_MARKER } from "./dev-reload-main-probe";
import { NotificationManager } from "./notification-manager";
import {
  NotificationPermissionService,
} from "./notification-permission";
import { checkForUpdate, initUpdateChecker } from "./update-checker";
import { ThemeManager } from "./theme-manager";
import { TerminalService } from "./terminal-service";
import {
  pollFeishuInstall,
  pollWeixinInstall,
  startFeishuInstallQrcode,
  startWeixinInstallQrcode,
} from "./connect-phone-install";
import { configureLogger } from "./logger";
import { ensurePathForGuiLaunch } from "./ensure-path";
import { seedBundledExtensions } from "./seed-extensions";
import type { DesktopAppState, ThemeMode } from "../src/desktop-state";
import { desktopIpc, getDesktopCommandFromShortcut, type OpenDesignStatus } from "../src/ipc";
import { SUPPORTED_COMPOSER_IMAGE_TYPES } from "../src/composer-attachments";
import type {
  ComposerAttachment,
  ComposerFileAttachment,
  ComposerImageAttachment,
  ConnectPhoneProvider,
  CreateSessionInput,
  CreateWorktreeInput,
  RemoveWorktreeInput,
  StartThreadInput,
  WorkspaceSessionTarget,
} from "../src/desktop-state";
import type { SessionDriverEvent } from "@pi-gui/session-driver";
import type { GenerateThreadTitleOptions } from "@pi-gui/pi-sdk-driver";
import { createImWebhookServer, type ImWebhookServer } from "./im-webhook-server";
import {
  configureWeixinBridgeRuntimeContextProvider,
  ensureWeixinBridgeRpcUrl,
  stopWeixinBridgeRuntime,
} from "./weixin-bridge-runtime";
import type { WorkspaceRef } from "@pi-gui/session-driver";
let autoUpdater: any;
try {
  const mod = require("electron-updater");
  autoUpdater = mod.autoUpdater;
} catch {
  // electron-updater not available in packaged build — auto-update disabled
  autoUpdater = null;
}

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
// Opt-in remote debugging for local verification only. Off unless PI_GUI_REMOTE_DEBUG
// is set, so packaged/normal dev runs are unaffected.
if (process.env.PI_GUI_REMOTE_DEBUG) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.PI_GUI_REMOTE_DEBUG);
  app.commandLine.appendSwitch("remote-allow-origins", "*");
}
const PI_WEIXIN_CHANNEL_ID = "pi-deepseek-weixin";
let autoUpdateEnabled = true;
let autoUpdateInterval: ReturnType<typeof setInterval> | undefined;
let skipAutoTitle = false;
let composerWorkMode: string = "pi-agent";
let imWebhookServer: ImWebhookServer | null = null;

function safeAutoUpdater() { return autoUpdater; }
const windowTestMode = resolveWindowTestMode();
const devReloadMarkersEnabled = process.env.PI_APP_DEV_RELOAD_MARKERS === "1";
let store: DesktopAppStore;
const themeManager = new ThemeManager();
let mainWindow: BrowserWindow | null = null;
let notificationManager: NotificationManager | undefined;
let notificationPermissionService: NotificationPermissionService | undefined;
let terminalService: TerminalService | undefined;
let integratedTerminalShell = "";
let stopPublishingState: (() => void) | undefined;
let stopPublishingSelectedTranscript: (() => void) | undefined;
let stopTrackingWindowActivation: (() => void) | undefined;
let stopNotifications: (() => void) | undefined;
let stopUpdateChecker: (() => void) | undefined;
let stopPruningTerminals: (() => void) | undefined;
let retainedTerminalWorkspacePathSignature = "";
const terminalFocusedWebContentsIds = new Set<number>();
let quittingAfterStoreFlush = false;

const SUPPORTED_IMAGE_TYPES = SUPPORTED_COMPOSER_IMAGE_TYPES;
const SUPPORTED_IMAGE_MIME_TYPES = new Set<string>(SUPPORTED_IMAGE_TYPES.map((type) => type.mimeType));
const OPEN_FOLDER_MENU_ITEM_ID = "file.open-folder";
const CHECK_FOR_UPDATES_MENU_ITEM_ID = "app.check-for-updates";
const MAX_CLIPBOARD_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_CLIPBOARD_IMAGE_DIMENSION = 8_192;

function getTerminalService(): TerminalService {
  if (!terminalService) {
    terminalService = new TerminalService({
      getWorkspacePath: (workspaceId) => store.getWorkspacePath(workspaceId),
      getIntegratedTerminalShell: () => integratedTerminalShell,
      isPackaged: app.isPackaged,
    });
  }
  return terminalService;
}

function isConnectPhoneProvider(provider: string): provider is ConnectPhoneProvider {
  return provider === "weixin" || provider === "feishu";
}

// Resolve the bundled application icon. In dev the repo's `resources/icon.png`
// sits two levels up from the compiled `out/main/main.js`; in a packaged build
// it is copied to `process.resourcesPath` via `extraResources` in
// electron-builder.yml. On macOS packaged builds the window/dock icon already
// comes from `icon.icns` in the app bundle, so we only need the PNG for dev
// and for Linux/Windows window chrome.
const appIconPath = app.isPackaged
  ? path.join(process.resourcesPath, "icon.png")
  : path.join(__dirname, "..", "..", "resources", "icon.png");
const appIcon = nativeImage.createFromPath(appIconPath);

function readClipboardImageAttachment(): ComposerImageAttachment | null {
  const image = clipboard.readImage();
  if (image.isEmpty()) {
    return null;
  }

  const size = image.getSize();
  if (size.width > MAX_CLIPBOARD_IMAGE_DIMENSION || size.height > MAX_CLIPBOARD_IMAGE_DIMENSION) {
    return null;
  }

  const png = image.toPNG();
  if (png.length === 0 || png.length > MAX_CLIPBOARD_IMAGE_BYTES) {
    return null;
  }

  return {
    id: randomUUID(),
    kind: "image",
    name: "pasted-image.png",
    mimeType: "image/png",
    data: png.toString("base64"),
  };
}

const PI_INSTALL_COMMAND = "curl -fsSL https://pi.dev/install.sh | sh";
const OPEN_DESIGN_EXTENSION_ID = "pi-open-design";
const OPEN_DESIGN_DEFAULT_DAEMON_URL = "http://127.0.0.1:7456";
const OPEN_DESIGN_DEFAULT_WEB_URL = "http://127.0.0.1:7456";

interface OpenDesignConfig {
  readonly daemonUrl: string;
  readonly webUrl: string;
  readonly extensionRoot?: string;
  readonly searchedExtensionRoots: readonly string[];
}

async function readOpenDesignConfig(): Promise<OpenDesignConfig> {
  const envDaemonUrl = process.env.OPEN_DESIGN_DAEMON_URL?.trim();
  const envWebUrl = process.env.OPEN_DESIGN_WEB_URL?.trim();
  let daemonUrl = envDaemonUrl || OPEN_DESIGN_DEFAULT_DAEMON_URL;
  let webUrl = envWebUrl || OPEN_DESIGN_DEFAULT_WEB_URL;
  let extensionRoot: string | undefined;
  const extensionRoots = getOpenDesignExtensionRootCandidates();

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

function getOpenDesignExtensionRootCandidates(): Set<string> {
  const roots = new Set<string>();
  const extensionRoots = new Set<string>();

  const addRoot = (root: string | undefined) => {
    if (!root) {
      return;
    }

    let current = path.resolve(root);
    for (let depth = 0; depth < 8 && !roots.has(current); depth += 1) {
      roots.add(current);
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  };

  const addExtensionRoot = (root: string | undefined) => {
    if (root) {
      extensionRoots.add(path.resolve(root));
    }
  };

  addExtensionRoot(process.env.OPEN_DESIGN_EXTENSION_ROOT?.trim());
  addRoot(process.cwd());
  addRoot(app.getAppPath());
  addRoot(__dirname);

  for (const root of roots) {
    addExtensionRoot(path.join(root, ".pi", "extensions", OPEN_DESIGN_EXTENSION_ID));
  }
  addExtensionRoot(path.join(app.getPath("home"), ".pi", "extensions", OPEN_DESIGN_EXTENSION_ID));

  return extensionRoots;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 3000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await net.fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOpenDesignJson(url: string): Promise<unknown> {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
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
      const versionResponse = await fetchOpenDesignJson(`${config.daemonUrl}/api/version`) as {
        version?: unknown;
        openDesignVersion?: unknown;
      };
      const nestedVersion = typeof versionResponse.version === "object" && versionResponse.version !== null
        ? (versionResponse.version as { version?: unknown }).version
        : undefined;
      version = typeof versionResponse.version === "string"
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
  const reachable = daemonReachable; // MCP mode: daemon API is all we need
  return {
    daemonUrl: config.daemonUrl,
    webUrl: config.webUrl,
    reachable,
    daemonReachable,
    webReachable,
    version,
    message: daemonReachable
      ? undefined
      : daemonMessage,
  };
}

function commandExists(command: string): boolean {
  if (existsSync(command)) {
    return true;
  }
  try {
    const which = spawnSync("which", [command], { timeout: 3000 });
    return which.status === 0 && which.stdout.toString().trim().length > 0;
  } catch {
    return false;
  }
}

function isSystemOdDumpCommand(command: string): boolean {
  if (command !== "od") {
    return false;
  }
  try {
    const which = spawnSync("which", [command], { timeout: 3000 });
    return which.stdout.toString().trim() === "/usr/bin/od";
  } catch {
    return false;
  }
}

async function resolveOpenDesignBinary(config: OpenDesignConfig): Promise<string> {
  const envBinary = process.env.OPEN_DESIGN_OD_BIN?.trim();
  if (envBinary) {
    return envBinary;
  }

  const bundledLauncher = config.extensionRoot ? path.join(config.extensionRoot, "bin", "od") : "";
  if (bundledLauncher && existsSync(bundledLauncher)) {
    return bundledLauncher;
  }

  const bundledInstaller = config.extensionRoot ? path.join(config.extensionRoot, "bin", "od-install") : "";
  if (bundledInstaller && existsSync(bundledInstaller)) {
    return bundledInstaller;
  }

  // Also check home directory
  const homeLauncher = path.join(app.getPath("home"), ".pi", "extensions", "pi-open-design", "bin", "od");
  if (existsSync(homeLauncher)) {
    return homeLauncher;
  }

  return "od";
}

function resolveOpenDesignRoot(config: OpenDesignConfig): string | undefined {
  const envRoot = process.env.OPEN_DESIGN_ROOT?.trim();
  const candidates = [
    envRoot,
    path.join(app.getPath("home"), "Sites", "Github", "open-design"),
    path.join(app.getPath("home"), ".pi", "open-design", "repo"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "apps", "web", "package.json"))) {
      return candidate;
    }
  }

  const installScript = config.extensionRoot ? path.join(config.extensionRoot, "bin", "od-install") : "";
  if (installScript && existsSync(installScript)) {
    return path.join(app.getPath("home"), ".pi", "open-design", "repo");
  }

  return undefined;
}

async function waitForOpenDesignDaemon(timeoutMs = 15_000): Promise<OpenDesignStatus> {
  const deadline = Date.now() + timeoutMs;
  let latestStatus = await getOpenDesignStatus();
  while (Date.now() < deadline) {
    if (latestStatus.daemonReachable) {
      return latestStatus;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    latestStatus = await getOpenDesignStatus();
  }
  return latestStatus;
}

async function waitForOpenDesignReady(timeoutMs = 25_000): Promise<OpenDesignStatus> {
  const deadline = Date.now() + timeoutMs;
  let latestStatus = await getOpenDesignStatus();
  while (Date.now() < deadline) {
    if (latestStatus.reachable) {
      return latestStatus;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    latestStatus = await getOpenDesignStatus();
  }
  return latestStatus;
}

function spawnDetached(command: string, args: readonly string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): void {
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    detached: true,
    env: {
      ...process.env,
      ...options.env,
    },
    stdio: "ignore",
  });
  child.unref();
}

async function startOpenDesignDaemon(config: OpenDesignConfig): Promise<OpenDesignStatus> {
  const currentStatus = await getOpenDesignStatus();
  if (currentStatus.daemonReachable) {
    return currentStatus;
  }

  const daemonUrl = new URL(config.daemonUrl);
  const port = daemonUrl.port || "7456";
  const binary = await resolveOpenDesignBinary(config);

  if (!commandExists(binary) || isSystemOdDumpCommand(binary)) {
    const expectedLauncher = config.extensionRoot
      ? path.join(config.extensionRoot, "bin", "od")
      : `one of ${config.searchedExtensionRoots.map((root) => path.join(root, "bin", "od")).join(", ")}`;
    return {
      ...currentStatus,
      reachable: false,
      daemonReachable: false,
      message: `Open Design CLI "${binary}" was not found. Expected ${expectedLauncher}, or set OPEN_DESIGN_OD_BIN.`,
    };
  }

  spawnDetached(binary, ["--port", port, "--no-open"], {
    env: {
      OD_PORT: port,
      OPEN_DESIGN_ROOT: process.env.OPEN_DESIGN_ROOT || path.join(app.getPath("home"), "Sites", "Github", "open-design"),
    },
  });

  const nextStatus = await waitForOpenDesignDaemon();
  if (!nextStatus.daemonReachable) {
    return {
      ...nextStatus,
      message: nextStatus.message || `Started ${binary}, but ${config.daemonUrl} did not become reachable.`,
    };
  }
  return nextStatus;
}

async function startOpenDesignWeb(config: OpenDesignConfig): Promise<OpenDesignStatus> {
  const currentStatus = await getOpenDesignStatus();
  if (currentStatus.webReachable) {
    return currentStatus;
  }

  const root = resolveOpenDesignRoot(config);
  if (!root) {
    return {
      ...currentStatus,
      reachable: false,
      webReachable: false,
      message: "Open Design web root was not found. Set OPEN_DESIGN_ROOT to the open-design repo path.",
    };
  }

  const webUrl = new URL(config.webUrl);
  const webPort = webUrl.port || "3000";
  const daemonPort = new URL(config.daemonUrl).port || "7456";
  const pnpmBinary = process.env.OPEN_DESIGN_PNPM_BIN?.trim()
    || (() => {
      for (const candidate of ["/opt/homebrew/bin/pnpm", path.join(app.getPath("home"), ".bun/bin/pnpm"), "/usr/local/bin/pnpm"]) {
        if (existsSync(candidate)) return candidate;
      }
      return "pnpm";
    })();
  if (!commandExists(pnpmBinary)) {
    return {
      ...currentStatus,
      reachable: false,
      webReachable: false,
      message: `pnpm binary "${pnpmBinary}" was not found. Install pnpm or set OPEN_DESIGN_PNPM_BIN.`,
    };
  }

  // Auto-install dependencies and build required packages if missing
  const pnpmBinary2 = process.env.OPEN_DESIGN_PNPM_BIN?.trim()
    || (() => {
      for (const candidate of ["/opt/homebrew/bin/pnpm", path.join(app.getPath("home"), ".bun/bin/pnpm"), "/usr/local/bin/pnpm"]) {
        if (existsSync(candidate)) return candidate;
      }
      return "pnpm";
    })();
  const pnpmDir = path.join(root, "node_modules", ".pnpm");
  if (!existsSync(pnpmDir)) {
    console.log("[Open Design] Installing dependencies...");
    spawnSync(pnpmBinary2, ["install"], { cwd: root, stdio: "pipe", timeout: 300_000 });
  }
  const componentsDist = path.join(root, "packages", "components", "dist");
  if (existsSync(path.join(root, "packages", "components", "package.json")) && !existsSync(componentsDist)) {
    console.log("[Open Design] Building components...");
    spawnSync(pnpmBinary2, ["--filter", "@open-design/components", "build"], { cwd: root, stdio: "pipe", timeout: 120_000 });
  }

  spawnDetached(pnpmBinary, ["--filter", "@open-design/web", "dev", "--hostname", webUrl.hostname, "--port", webPort], {
    cwd: root,
    env: {
      OD_PORT: daemonPort,
      OPEN_DESIGN_ROOT: root,
      OD_WORKSPACE_ROOT: root,
    },
  });

  const nextStatus = await waitForOpenDesignReady();
  if (!nextStatus.webReachable) {
    return {
      ...nextStatus,
      message: nextStatus.message || `Started Open Design web server, but ${config.webUrl} did not become reachable.`,
    };
  }
  return nextStatus;
}

async function startOpenDesign(): Promise<OpenDesignStatus> {
  const config = await readOpenDesignConfig();
  const daemonStatus = await startOpenDesignDaemon(config);
  if (!daemonStatus.daemonReachable) {
    return daemonStatus;
  }

  const webStatus = await startOpenDesignWeb(config);
  if (webStatus.reachable) {
    return webStatus;
  }

  return {
    ...webStatus,
    message: webStatus.message || "Open Design daemon started, but the web UI did not become reachable.",
  };
}

function isPiCliInstalled(): boolean {
  // pi-coding-agent is a dependency of this app, always bundled in the asar.
  // If the app is running, pi is available — no need for shell commands.
  return true;
}

async function checkPiCliAndPrompt(): Promise<void> {
  // Skip check in test mode
  if (process.env.PI_APP_TEST_MODE) {
    return;
  }

  if (isPiCliInstalled()) {
    return;
  }

  const result = await dialog.showMessageBox({
    type: "warning",
    title: "pi CLI not found / pi CLI 未安装 / pi CLI が見つかりません",
    message: "The `pi` command-line tool was not detected on your system.\n\npi is required for session management and agent execution.\n\n未检测到 `pi` 命令行工具。pi 是会话管理和智能体运行的必要依赖。\n\n`pi` コマンドが検出されませんでした。pi はセッション管理とエージェント実行に必要です。\n\nRun this command to install / 运行以下命令安装 / 以下のコマンドでインストール：",
    detail: PI_INSTALL_COMMAND,
    buttons: ["Copy Command / 复制命令 / コマンドをコピー", "OK"],
    defaultId: 0,
    cancelId: 1,
  });

  if (result.response === 0) {
    clipboard.writeText(PI_INSTALL_COMMAND);
  }
}

async function registerBuiltInPlugins(): Promise<void> {
  // Auto-register Pi-OpenDesign plugin
  const pluginRoots = [
    path.join(require("os").homedir(), ".pi", "extensions", "pi-open-design"),
    path.join(process.cwd(), ".pi", "extensions", "pi-open-design"),
    path.join(path.dirname(app.getAppPath()), "..", "..", "..", ".pi", "extensions", "pi-open-design"),
  ];

  let pluginPath = "";
  for (const root of pluginRoots) {
    const normalized = path.resolve(root);
    if (existsSync(path.join(normalized, "package.json"))) {
      pluginPath = normalized;
      break;
    }
  }
  if (!pluginPath) return;

  // Register in ~/.pi/agent/settings.json
  const settingsPath = path.join(require("os").homedir(), ".pi", "agent", "settings.json");
  try {
    const raw = existsSync(settingsPath) ? await readFile(settingsPath, "utf8") : "{}";
    const settings = JSON.parse(raw) as Record<string, unknown>;
    const packages: string[] = Array.isArray(settings.packages) ? [...settings.packages] : [];
    if (!packages.some((p: string) => p.includes("pi-open-design"))) {
      packages.push(pluginPath);
      settings.packages = packages;
      await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
      console.log(`[Pi-Deepseek] Auto-registered plugin: ${pluginPath}`);
    }
  } catch { /* silently skip */ }
}

function startAutoUpdateChecker(): void {
  if (isDev || autoUpdateInterval) return;
  autoUpdateInterval = setInterval(async () => {
    try {
      const result = await safeAutoUpdater()?.checkForUpdates();
      if (result?.updateInfo?.version) {
        const latest = result.updateInfo.version;
        if (latest !== app.getVersion()) {
          await safeAutoUpdater()?.downloadUpdate();
        }
      }
    } catch {}
  }, 4 * 60 * 60 * 1000); // Check every 4 hours
  // Also check immediately on first start
  setTimeout(async () => {
    try {
      const result = await safeAutoUpdater()?.checkForUpdates();
      if (result?.updateInfo?.version) {
        const latest = result.updateInfo.version;
        if (latest !== app.getVersion()) {
          await safeAutoUpdater()?.downloadUpdate();
        }
      }
    } catch {}
  }, 30000); // Wait 30s after startup
}

function stopAutoUpdateChecker(): void {
  if (autoUpdateInterval) {
    clearInterval(autoUpdateInterval);
    autoUpdateInterval = undefined;
  }
}

function createWindow(): BrowserWindow {
  const backgroundTestMode = windowTestMode === "background";
  const enableTransparency = store ? store.state.enableTransparency : false;
  const window = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    transparent: enableTransparency,
    vibrancy: process.platform === "darwin" && enableTransparency ? "under-window" : undefined,
    titleBarStyle: "hiddenInset",
    backgroundColor: enableTransparency ? "#00000000" : "#f3f4f8",
    trafficLightPosition: { x: 18, y: 18 },
    show: false,
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Keep hidden test windows responsive so Playwright exercises the same UI flows.
      backgroundThrottling: !backgroundTestMode,
    },
  });

  window.once("ready-to-show", () => {
    if (!backgroundTestMode) {
      window.show();
    }
  });
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") {
      return;
    }

    const lowerKey = input.key.toLowerCase();
    const platformModifier = process.platform === "darwin" ? input.meta : input.control;
    const terminalFocused = terminalFocusedWebContentsIds.has(window.webContents.id);
    if (terminalFocused) {
      return;
    }
    if (platformModifier && !input.shift && lowerKey === "o") {
      event.preventDefault();
      void pickWorkspaceViaDialog();
      return;
    }

    if (platformModifier && !input.shift && lowerKey === "v") {
      const clipboardImage = readClipboardImageAttachment();
      if (clipboardImage) {
        event.preventDefault();
        window.webContents.send(desktopIpc.clipboardImagePasted, clipboardImage);
        return;
      }
    }

    const command = getDesktopCommandFromShortcut({
      modifier: process.platform === "darwin" ? input.meta : input.control,
      shift: input.shift,
      key: input.key,
      code: input.code,
    });
    if (command) {
      event.preventDefault();
      window.webContents.send(desktopIpc.appCommand, command);
    }
  });

  if (isDev) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL as string);
    if (process.env.PI_APP_OPEN_DEVTOOLS !== "0") {
      window.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    const indexPath = path.join(__dirname, "..", "renderer", "index.html");
    void window.loadURL(pathToFileURL(indexPath).toString());
  }

  return window;
}

function attachStatePublisher(window: BrowserWindow): void {
  const webContentsId = window.webContents.id;
  stopPublishingState?.();
  stopPublishingSelectedTranscript?.();
  stopPublishingState = store.subscribe((state) => {
    if (canPublishToWindow(window)) {
      window.webContents.send(desktopIpc.stateChanged, state);
    }
  });
  stopPublishingSelectedTranscript = store.subscribeToSelectedTranscript((payload) => {
    if (canPublishToWindow(window) && payload) {
      const len = payload.transcript?.length ?? 0;
      if (len > 150) {
        payload = { ...payload, transcript: payload.transcript.slice(-150) };
      }
      window.webContents.send(desktopIpc.selectedTranscriptChanged, payload);
    }
  });
  window.webContents.once("render-process-gone", () => {
    stopPublishingState?.();
    stopPublishingState = undefined;
    stopPublishingSelectedTranscript?.();
    stopPublishingSelectedTranscript = undefined;
  });
  window.once("closed", () => {
    stopPublishingState?.();
    stopPublishingState = undefined;
    stopPublishingSelectedTranscript?.();
    stopPublishingSelectedTranscript = undefined;
    if (mainWindow === window) {
      mainWindow = null;
    }
    terminalFocusedWebContentsIds.delete(webContentsId);
    terminalService?.dispose();
  });
}

function attachViewedSessionTracking(window: BrowserWindow): void {
  stopTrackingWindowActivation?.();

  const handleActivation = () => {
    store.handleWindowActivation();
  };
  const clearTracking = () => {
    stopTrackingWindowActivation?.();
    stopTrackingWindowActivation = undefined;
  };

  window.on("focus", handleActivation);
  window.on("show", handleActivation);
  window.on("restore", handleActivation);
  window.once("closed", clearTracking);

  stopTrackingWindowActivation = () => {
    window.off("focus", handleActivation);
    window.off("show", handleActivation);
    window.off("restore", handleActivation);
    window.off("closed", clearTracking);
  };
}

function canPublishToWindow(window: BrowserWindow): boolean {
  return !window.isDestroyed() && !window.webContents.isDestroyed() && !window.webContents.isCrashed();
}

function resolveWindowTestMode(): "foreground" | "background" {
  return process.env.PI_APP_TEST_MODE?.trim().toLowerCase() === "background" ? "background" : "foreground";
}

async function pickWorkspaceViaDialog(): Promise<DesktopAppState> {
  const window = mainWindow && canPublishToWindow(mainWindow) ? mainWindow : undefined;
  const result = window
    ? await dialog.showOpenDialog(window, {
        properties: ["openDirectory"],
        title: "Open workspace folder",
      })
    : await dialog.showOpenDialog({
        properties: ["openDirectory"],
        title: "Open workspace folder",
      });
  if (result.canceled || result.filePaths.length === 0) {
    return store.getState();
  }
  const nextState = await store.addWorkspace(result.filePaths[0] as string);
  if (!nextState.selectedWorkspaceId) {
    return nextState;
  }
  const newThreadState =
    nextState.activeView === "new-thread" ? nextState : await store.setActiveView("new-thread");
  if (window) {
    window.webContents.send(desktopIpc.workspacePicked, nextState.selectedWorkspaceId);
  }
  return newThreadState;
}

async function runManualUpdateCheck(): Promise<void> {
  const window = mainWindow && canPublishToWindow(mainWindow) ? mainWindow : undefined;
  const result = await checkForUpdate();

  if (result.status === "update-available") {
    return;
  }

  if (result.status === "up-to-date") {
    const options: MessageBoxOptions = {
      type: "info",
      title: "Pi-Deepseek",
      message: `You're up to date on version ${result.currentVersion}.`,
      buttons: ["OK"],
    };
    if (window) {
      await dialog.showMessageBox(window, options);
    } else {
      await dialog.showMessageBox(options);
    }
    return;
  }

  const options: MessageBoxOptions = {
    type: "warning",
    title: "Pi-Deepseek",
    message: "Could not check for updates right now.",
    detail: result.message,
    buttons: ["OK"],
  };
  if (window) {
    await dialog.showMessageBox(window, options);
  } else {
    await dialog.showMessageBox(options);
  }
}

function installApplicationMenu(): void {
  if (process.platform !== "darwin") {
    return;
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          id: CHECK_FOR_UPDATES_MENU_ITEM_ID,
          label: "Check for Updates…",
          click: () => {
            void runManualUpdateCheck();
          },
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          id: OPEN_FOLDER_MENU_ITEM_ID,
          label: "Open Folder…",
          accelerator: "Command+O",
          click: () => {
            void pickWorkspaceViaDialog();
          },
        },
        { type: "separator" },
        { role: "close" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    {
      // Custom Window submenu so Cmd+M is freed from the default Minimize
      // accelerator and can drive the in-app Connect Phone shortcut instead.
      // Minimize stays available as a (shortcut-less) menu item.
      role: "windowMenu",
      submenu: [
        {
          label: "Minimize",
          click: () => {
            BrowserWindow.getFocusedWindow()?.minimize();
          },
        },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.setName("pi");

const configuredUserDataDir = process.env.PI_APP_USER_DATA_DIR?.trim() || app.getPath("userData").replace(/\/pi$/, "/pi-deepseek");
app.setPath("userData", configuredUserDataDir);

const shouldRequestSingleInstanceLock = !process.env.PI_APP_TEST_MODE;
const hasSingleInstanceLock = shouldRequestSingleInstanceLock ? app.requestSingleInstanceLock() : true;
if (!hasSingleInstanceLock) {
  console.error(`[Pi-Deepseek] Single instance lock failed. userData: ${configuredUserDataDir}`);
  app.quit();
}

app.on("second-instance", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) {
    return;
  }

  // Restore a full PATH before anything spawns child processes (pi MCP bridge
  // launches `uvx` for Unity); GUI launches otherwise inherit a stripped PATH.
  ensurePathForGuiLaunch();

  // Seed bundled pi extensions (MCP Bridge) into the shared ~/.pi/agent so the
  // runtime auto-discovers them. No-op if already installed or in dev.
  seedBundledExtensions();

  // On macOS, packaged builds already render the dock icon from `icon.icns`
  // in the app bundle. In dev we override the generic Electron dock icon with
  // the real PNG so the running app looks right end-to-end.
  if (process.platform === "darwin" && !app.isPackaged) {
    app.dock?.setIcon(appIcon);
  }

  let generateThreadTitleOverride:
    | ((workspace: WorkspaceRef, options: GenerateThreadTitleOptions) => Promise<string | null | undefined>)
    | undefined;
  let deferredThreadTitle:
    | {
        resolve: (title: string | null) => void;
        reject: (error: Error) => void;
      }
    | undefined;
  store = new DesktopAppStore({
    userDataDir: configuredUserDataDir,
    initialWorkspacePaths: resolveInitialWorkspacePaths(),
    getWindow: () => mainWindow,
    generateThreadTitleOverride: async (workspace, options) => {
      if (skipAutoTitle) return null;
      return generateThreadTitleOverride?.(workspace, options);
    },
  });
  await store.initialize();
  configureLogger({
    dir: path.join(app.getPath("userData"), "logs"),
    enabled: true,
    retentionDays: 3,
  });

  // Check if pi CLI is installed; prompt user if not.
  await checkPiCliAndPrompt();

  // Auto-register built-in plugins
  await registerBuiltInPlugins();

  integratedTerminalShell = (await store.getState()).integratedTerminalShell;
  stopPruningTerminals = store.subscribe((state) => {
    integratedTerminalShell = state.integratedTerminalShell;
    const workspacePaths = state.workspaces.map((workspace) => workspace.path);
    const workspacePathSignature = workspacePaths.join("\0");
    if (workspacePathSignature !== retainedTerminalWorkspacePathSignature) {
      retainedTerminalWorkspacePathSignature = workspacePathSignature;
      terminalService?.retainWorkspacePaths(workspacePaths);
    }
  });
  installApplicationMenu();
  startAutoUpdateChecker();

  // Start IM webhook server for WeChat/Feishu message reception
  imWebhookServer = createImWebhookServer(store);
  imWebhookServer.start().catch((error) => {
    console.error("[IM Webhook] Failed to start:", error);
  });
  configureWeixinBridgeRuntimeContextProvider(async () => ({
    webhookUrl: `http://127.0.0.1:${imWebhookServer?.port ?? 8789}/im/webhook`,
    webhookSecret: process.env.IM_WEBHOOK_SECRET?.trim() || "",
    channelId: PI_WEIXIN_CHANNEL_ID,
  }));
  ensureWeixinBridgeRpcUrl().catch((error) => {
    console.error("[Weixin Bridge] Failed to start:", error);
  });

  if (process.env.PI_APP_TEST_MODE) {
    Object.assign(globalThis, {
      __PI_APP_TEST_HOOKS: {
        emitSessionEvent: (event: SessionDriverEvent) => store.emitTestSessionEvent(event),
        setDeferredThreadTitleMode: () => {
          generateThreadTitleOverride = () =>
            new Promise<string | null>((resolve, reject) => {
              deferredThreadTitle = { resolve, reject };
            });
        },
        hasDeferredThreadTitle: () => Boolean(deferredThreadTitle),
        resolveDeferredThreadTitle: (title: string) => {
          if (!deferredThreadTitle) {
            throw new Error("Deferred thread-title request is unavailable");
          }
          const pending = deferredThreadTitle;
          deferredThreadTitle = undefined;
          pending.resolve(title);
        },
        rejectDeferredThreadTitle: () => {
          if (!deferredThreadTitle) {
            throw new Error("Deferred thread-title request is unavailable");
          }
          const pending = deferredThreadTitle;
          deferredThreadTitle = undefined;
          pending.reject(new Error("Deferred thread-title rejected by test"));
        },
      },
    });
  }
  notificationPermissionService = new NotificationPermissionService(() => mainWindow);
  notificationPermissionService.subscribe((status) => {
    if (mainWindow && canPublishToWindow(mainWindow)) {
      mainWindow.webContents.send(desktopIpc.notificationPermissionStatusChanged, status);
    }
  });
  notificationManager = new NotificationManager(store, () => mainWindow, notificationPermissionService);
  stopNotifications = notificationManager.start();
  if (!isDev) {
    stopUpdateChecker = initUpdateChecker();
  }

  ipcMain.handle(desktopIpc.ping, () =>
    devReloadMarkersEnabled ? `pi desktop ready:${MAIN_DEV_RELOAD_MARKER}` : "pi desktop ready",
  );
  ipcMain.handle(desktopIpc.getThemeMode, () => themeManager.getMode());
  ipcMain.handle(desktopIpc.getResolvedTheme, () => themeManager.getResolvedTheme());
  ipcMain.handle(desktopIpc.setThemeMode, (_event, mode: ThemeMode) => {
    themeManager.setMode(mode);
    return mode;
  });
  ipcMain.handle(desktopIpc.openExternal, (_event, url: string) => {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`Refusing to open unsupported URL: ${url}`);
    }
    return shell.openExternal(url);
  });
  ipcMain.handle(desktopIpc.getOpenDesignStatus, () => getOpenDesignStatus());
  ipcMain.handle(desktopIpc.installOpenDesign, async () => {
    const root = path.join(app.getPath("home"), "Sites", "Github", "open-design");
    if (!existsSync(root)) return { ok: false, message: "open-design repo not found" };
    try {
      spawnSync("pnpm", ["install"], { cwd: root, stdio: "pipe", timeout: 180_000, env: { ...process.env } });
      spawnSync("pnpm", ["rebuild", "better-sqlite3"], { cwd: root, stdio: "pipe", timeout: 60_000, env: { ...process.env } });
      return { ok: true, message: "Dependencies installed & rebuilt. Restart daemon." };
    } catch (e: any) {
      return { ok: false, message: e.message };
    }
  });
  ipcMain.handle(desktopIpc.stateRequest, () => store.getState());
  ipcMain.handle(desktopIpc.selectedTranscriptRequest, () => store.getSelectedTranscript());
  ipcMain.handle(desktopIpc.transcriptForRequest, (_event, target: WorkspaceSessionTarget) =>
    store.getTranscriptFor(target),
  );
  ipcMain.handle(desktopIpc.addWorkspacePath, (_event, workspacePath: string) => store.addWorkspace(workspacePath));
  ipcMain.handle(desktopIpc.pickWorkspace, () => pickWorkspaceViaDialog());
  ipcMain.handle(desktopIpc.selectWorkspace, (_event, workspaceId: string) => store.selectWorkspace(workspaceId));
  ipcMain.handle(desktopIpc.renameWorkspace, (_event, workspaceId: string, displayName: string) =>
    store.renameWorkspace(workspaceId, displayName),
  );
  ipcMain.handle(desktopIpc.removeWorkspace, (_event, workspaceId: string) => store.removeWorkspace(workspaceId));
  ipcMain.handle(desktopIpc.reorderWorkspaces, (_event, order: readonly string[]) => store.reorderWorkspaces(order));
  ipcMain.handle(desktopIpc.openWorkspaceInFinder, async (_event, workspaceId: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      throw new Error(`Unknown workspace: ${workspaceId}`);
    }
    await shell.openPath(workspacePath);
  });
  ipcMain.handle(desktopIpc.createWorktree, (_event, input: CreateWorktreeInput) =>
    store.createWorktree(input),
  );
  ipcMain.handle(desktopIpc.removeWorktree, (_event, input: RemoveWorktreeInput) =>
    store.removeWorktree(input),
  );
  ipcMain.handle(desktopIpc.syncCurrentWorkspace, () => store.syncCurrentWorkspace());
  ipcMain.handle(desktopIpc.selectSession, (_event, target: WorkspaceSessionTarget) =>
    store.selectSession(target),
  );
  ipcMain.handle(desktopIpc.archiveSession, (_event, target: WorkspaceSessionTarget) =>
    store.archiveSession(target),
  );
  ipcMain.handle(desktopIpc.unarchiveSession, (_event, target: WorkspaceSessionTarget) =>
    store.unarchiveSession(target),
  );
  ipcMain.handle(desktopIpc.setActiveView, (_event, activeView) => store.setActiveView(activeView));
  ipcMain.handle(desktopIpc.setSidebarCollapsed, (_event, collapsed: boolean) =>
    store.setSidebarCollapsed(collapsed),
  );
  ipcMain.handle(desktopIpc.setWorkspaceCollapsed, (_event, workspaceId: string, collapsed: boolean) =>
    store.setWorkspaceCollapsed(workspaceId, collapsed),
  );
  ipcMain.handle(desktopIpc.setArchivedSectionExpanded, (_event, workspaceId: string, expanded: boolean) =>
    store.setArchivedSectionExpanded(workspaceId, expanded),
  );
  ipcMain.handle(desktopIpc.refreshRuntime, (_event, workspaceId?: string) => store.refreshRuntime(workspaceId));
  ipcMain.handle(desktopIpc.setModelSettingsScopeMode, (_event, mode) => store.setModelSettingsScopeMode(mode));
  ipcMain.handle(desktopIpc.setSessionModel, (_event, workspaceId: string, sessionId: string, provider: string, modelId: string) =>
    store.setSessionModel({ workspaceId, sessionId }, provider, modelId),
  );
  ipcMain.handle(desktopIpc.setDefaultModel, (_event, workspaceId: string, provider: string, modelId: string) =>
    store.setDefaultModel(workspaceId, provider, modelId),
  );
  ipcMain.handle(
    desktopIpc.setDefaultThinkingLevel,
    (_event, workspaceId: string, thinkingLevel) => store.setDefaultThinkingLevel(workspaceId, thinkingLevel),
  );
  ipcMain.handle(
    desktopIpc.setSessionThinkingLevel,
    (_event, workspaceId: string, sessionId: string, thinkingLevel) =>
      store.setSessionThinkingLevel({ workspaceId, sessionId }, thinkingLevel),
  );
  ipcMain.handle(desktopIpc.loginProvider, (_event, workspaceId: string, providerId: string) =>
    store.loginProvider(workspaceId, providerId, createRuntimeLoginCallbacks()),
  );
  ipcMain.handle(desktopIpc.logoutProvider, (_event, workspaceId: string, providerId: string) =>
    store.logoutProvider(workspaceId, providerId),
  );
  ipcMain.handle(desktopIpc.setProviderApiKey, (_event, workspaceId: string, providerId: string, apiKey: string) =>
    store.setProviderApiKey(workspaceId, providerId, apiKey),
  );
  ipcMain.handle(desktopIpc.setEnableSkillCommands, (_event, workspaceId: string, enabled: boolean) =>
    store.setEnableSkillCommands(workspaceId, enabled),
  );
  ipcMain.handle(desktopIpc.setScopedModelPatterns, (_event, workspaceId: string, patterns: readonly string[]) =>
    store.setScopedModelPatterns(workspaceId, patterns),
  );
  ipcMain.handle(desktopIpc.setSkillEnabled, (_event, workspaceId: string, filePath: string, enabled: boolean) =>
    store.setSkillEnabled(workspaceId, filePath, enabled),
  );
  ipcMain.handle(desktopIpc.setExtensionEnabled, (_event, workspaceId: string, filePath: string, enabled: boolean) =>
    store.setExtensionEnabled(workspaceId, filePath, enabled),
  );
  ipcMain.handle(desktopIpc.respondToHostUiRequest, (_event, workspaceId: string, sessionId: string, response) =>
    store.respondToHostUiRequest({ workspaceId, sessionId }, response),
  );
  ipcMain.handle(desktopIpc.setNotificationPreferences, (_event, preferences) =>
    store.setNotificationPreferences(preferences),
  );
  ipcMain.handle(desktopIpc.saveImChannel, (_event, input) =>
    store.saveImChannel(input),
  );
  ipcMain.handle(desktopIpc.removeImChannel, (_event, channelId: string) =>
    store.removeImChannel(channelId),
  );
  ipcMain.handle(desktopIpc.updateImChannelSession, async (_event, provider: string, sessionId: string) => {
    if (!isConnectPhoneProvider(provider)) {
      return store.getState();
    }
    return store.updateImChannelSession(provider, sessionId);
  });
  ipcMain.handle(desktopIpc.startConnectPhoneQr, async (_event, input: { readonly provider?: string; readonly isLark?: boolean }) => {
    try {
      if (input.provider === "weixin") {
        return await startWeixinInstallQrcode((url, init) => net.fetch(url, init));
      }
      if (input.provider === "feishu") {
        return await startFeishuInstallQrcode((url, init) => net.fetch(url, init), input.isLark === true);
      }
      return { ok: false, message: "暂不支持该连接方式。" };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle(desktopIpc.pollConnectPhoneQr, async (_event, provider: string, deviceCode: string) => {
    try {
      if (!deviceCode.trim()) {
        return { done: false, message: "二维码会话已过期，请重新生成。" };
      }
      if (provider === "weixin") {
        return pollWeixinInstall((url, init) => net.fetch(url, init), deviceCode);
      }
      if (provider === "feishu") {
        return pollFeishuInstall((url, init) => net.fetch(url, init), deviceCode);
      }
      return { done: false, message: "暂不支持该连接方式。" };
    } catch (error) {
      return { done: false, message: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle(desktopIpc.setIntegratedTerminalShell, (_event, shellPath: string) =>
    store.setIntegratedTerminalShell(shellPath),
  );
  ipcMain.handle(desktopIpc.setEnableTransparency, async (_event, enabled: boolean) => {
    const nextState = await store.setEnableTransparency(enabled);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (process.platform === "darwin") {
        mainWindow.setVibrancy(enabled ? "under-window" : null);
      }
    }
    return nextState;
  });
  ipcMain.handle(desktopIpc.setLocale, async (_event, locale: string) => {
    return store.setLocale(locale);
  });
  ipcMain.handle(desktopIpc.getLocale, async () => {
    return store.getLocale();
  });
  ipcMain.handle(desktopIpc.getProviderBalance, async (_event, providerId: string) => {
    try {
      const auth = store.getProviderAuth(providerId);
      if (!auth) return { error: "No auth configured" };
      const resp = await net.fetch(`https://api.deepseek.com/user/balance`, {
        headers: { Authorization: `Bearer ${auth}` },
      });
      if (!resp.ok) return { error: `API error ${resp.status}` };
      const data = await resp.json() as any;
      const bal = data?.balance_infos?.[0]?.total_balance ?? data?.data?.balance ?? "?";
      return { balance: String(bal) };
    } catch (e: any) {
      return { error: e.message };
    }
  });
  ipcMain.handle(desktopIpc.checkForUpdate, async () => {
    if (isDev) return { status: "dev" };
    try {
      const result = await safeAutoUpdater()?.checkForUpdates();
      if (result?.updateInfo?.version) {
        const latest = result.updateInfo.version;
        const current = app.getVersion();
        if (latest !== current) {
          return { status: "available", current, latest };
        }
        return { status: "up-to-date", current };
      }
      return { status: "error", message: "No update info" };
    } catch (e: any) {
      return { status: "error", message: e.message };
    }
  });
  ipcMain.handle(desktopIpc.downloadUpdate, async () => {
    if (isDev) return { status: "dev" };
    try {
      await safeAutoUpdater()?.downloadUpdate();
      return { status: "downloaded" };
    } catch (e: any) {
      return { status: "error", message: e.message };
    }
  });
  ipcMain.handle(desktopIpc.installUpdate, async () => {
    safeAutoUpdater()?.quitAndInstall();
  });
  ipcMain.handle(desktopIpc.setAutoUpdateEnabled, async (_event, enabled: boolean) => {
    autoUpdateEnabled = enabled;
    if (enabled) {
      startAutoUpdateChecker();
    } else {
      stopAutoUpdateChecker();
    }
    return enabled;
  });
  ipcMain.handle(desktopIpc.getAutoUpdateEnabled, async () => autoUpdateEnabled);
  ipcMain.handle(desktopIpc.setSkipAutoTitle, async (_event, skip: boolean) => {
    skipAutoTitle = skip;
    return skip;
  });
  ipcMain.handle(desktopIpc.setComposerWorkMode, async (_event, mode: string) => {
    composerWorkMode = mode === "open-design" ? "open-design" : "pi-agent";
    return store.emit();
  });
  ipcMain.handle(desktopIpc.getComposerWorkMode, async () => {
    return composerWorkMode;
  });
  ipcMain.handle(desktopIpc.terminalEnsurePanel, (event, workspaceId: string, terminalScopeId: string, size) => {
    return getTerminalService().ensurePanel(event.sender, workspaceId, terminalScopeId, size);
  });
  ipcMain.handle(desktopIpc.terminalCreateSession, (event, workspaceId: string, terminalScopeId: string, size) => {
    return getTerminalService().createSession(event.sender, workspaceId, terminalScopeId, size);
  });
  ipcMain.handle(desktopIpc.terminalSetActiveSession, (event, workspaceId: string, terminalScopeId: string, terminalId: string) => {
    return getTerminalService().setActiveSession(event.sender, workspaceId, terminalScopeId, terminalId);
  });
  ipcMain.handle(desktopIpc.terminalWrite, (event, terminalId: string, data: string) => {
    terminalService?.write(event.sender, terminalId, data);
  });
  ipcMain.handle(desktopIpc.terminalResize, (event, terminalId: string, size) => {
    terminalService?.resize(event.sender, terminalId, size);
  });
  ipcMain.handle(desktopIpc.terminalRestartSession, (event, terminalId: string, size) => {
    return getTerminalService().restart(event.sender, terminalId, size);
  });
  ipcMain.handle(desktopIpc.terminalCloseSession, (event, terminalId: string) => {
    return getTerminalService().close(event.sender, terminalId);
  });
  ipcMain.handle(desktopIpc.terminalSetTitle, (event, terminalId: string, title: string) => {
    terminalService?.setTitle(event.sender, terminalId, title);
  });
  ipcMain.on(desktopIpc.terminalSetFocused, (event, focused: boolean) => {
    if (focused) {
      terminalFocusedWebContentsIds.add(event.sender.id);
    } else {
      terminalFocusedWebContentsIds.delete(event.sender.id);
    }
  });
  ipcMain.handle(desktopIpc.getNotificationPermissionStatus, () =>
    notificationPermissionService?.getCurrentStatus() ?? Promise.resolve("unknown"),
  );
  ipcMain.handle(desktopIpc.requestNotificationPermission, () =>
    notificationPermissionService?.requestPermission() ?? Promise.resolve("unknown"),
  );
  ipcMain.handle(desktopIpc.openSystemNotificationSettings, () =>
    notificationPermissionService?.openSystemSettings() ?? Promise.resolve(),
  );
  ipcMain.handle(desktopIpc.createSession, (_event, input: CreateSessionInput) =>
    store.createSession(input),
  );
  ipcMain.handle(desktopIpc.startThread, (_event, input: StartThreadInput) => store.startThread(input));
  ipcMain.handle(desktopIpc.openSkillInFinder, async (_event, workspaceId: string, filePath: string) => {
    const resolved = store.getSkillFilePath(workspaceId, filePath);
    if (!resolved) {
      throw new Error(`Unknown skill: ${filePath}`);
    }
    await shell.openPath(path.dirname(resolved));
  });
  ipcMain.handle(desktopIpc.openExtensionInFinder, async (_event, workspaceId: string, filePath: string) => {
    const resolved = store.getExtensionFilePath(workspaceId, filePath);
    if (!resolved) {
      throw new Error(`Unknown extension: ${filePath}`);
    }
    await shell.openPath(path.dirname(resolved));
  });
  ipcMain.handle(desktopIpc.cancelCurrentRun, () => store.cancelCurrentRun());
  ipcMain.handle(desktopIpc.pickComposerAttachments, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      title: "Attach files",
    });
    if (result.canceled || result.filePaths.length === 0) {
      return store.getState();
    }
    const attachments = await Promise.all(result.filePaths.map(readComposerAttachment));
    return store.addComposerAttachments(attachments);
  });
  ipcMain.on(desktopIpc.readClipboardImage, (event) => {
    event.returnValue = readClipboardImageAttachment();
  });
  ipcMain.handle(desktopIpc.addComposerAttachments, (_event, attachments: readonly ComposerAttachment[]) => {
    const validated = attachments.flatMap(validateComposerAttachmentPayload);
    return store.addComposerAttachments(validated);
  });
  ipcMain.handle(desktopIpc.removeComposerAttachment, (_event, attachmentId: string) =>
    store.removeComposerAttachment(attachmentId),
  );
  ipcMain.handle(desktopIpc.editQueuedComposerMessage, (_event, messageId: string, currentDraft?: string) =>
    store.editQueuedComposerMessage(messageId, currentDraft),
  );
  ipcMain.handle(desktopIpc.cancelQueuedComposerEdit, () =>
    store.cancelQueuedComposerEdit(),
  );
  ipcMain.handle(desktopIpc.removeQueuedComposerMessage, (_event, messageId: string) =>
    store.removeQueuedComposerMessage(messageId),
  );
  ipcMain.handle(desktopIpc.steerQueuedComposerMessage, (_event, messageId: string) =>
    store.steerQueuedComposerMessage(messageId),
  );
  ipcMain.handle(desktopIpc.updateComposerDraft, (_event, composerDraft: string) =>
    store.updateComposerDraft(composerDraft),
  );
  ipcMain.handle(
    desktopIpc.submitComposer,
    (_event, text: string, options?: { readonly deliverAs?: "steer" | "followUp" }) => store.submitComposer(text, options),
  );
  ipcMain.handle(
    desktopIpc.submitComposerFor,
    (_event, target: WorkspaceSessionTarget, text: string, options?: { readonly deliverAs?: "steer" | "followUp" }) =>
      store.submitComposerFor(target, text, options),
  );
  ipcMain.handle(desktopIpc.getSessionTree, (_event, target: WorkspaceSessionTarget) =>
    store.getSessionTree(target),
  );
  ipcMain.handle(
    desktopIpc.navigateSessionTree,
    (_event, target: WorkspaceSessionTarget, targetId: string, options) =>
      store.navigateSessionTree(target, targetId, options),
  );
  ipcMain.handle(desktopIpc.listWorkspaceFiles, async (_event, workspaceId: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      return [];
    }
    return listWorkspaceFiles(workspacePath);
  });
  ipcMain.handle(desktopIpc.getChangedFiles, async (_event, workspaceId: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      return [];
    }
    return getChangedFiles(workspacePath);
  });
  ipcMain.handle(desktopIpc.getFileDiff, async (_event, workspaceId: string, filePath: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      return "";
    }
    return getFileDiff(workspacePath, filePath);
  });
  ipcMain.handle(desktopIpc.stageFile, async (_event, workspaceId: string, filePath: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      throw new Error(`Unknown workspace: ${workspaceId}`);
    }
    await stageFile(workspacePath, filePath);
  });
  ipcMain.handle(desktopIpc.toggleWindowMaximize, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return;
    }

    if (window.isMaximized()) {
      window.unmaximize();
      return;
    }

    window.maximize();
  });

  mainWindow = createWindow();
  notificationManager.trackWindow(mainWindow);
  notificationPermissionService.trackWindow(mainWindow);
  themeManager.setWindow(mainWindow);
  attachStatePublisher(mainWindow);
  attachViewedSessionTracking(mainWindow);
  void notificationPermissionService.getCurrentStatus();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      notificationManager?.trackWindow(mainWindow);
      notificationPermissionService?.trackWindow(mainWindow);
      themeManager.setWindow(mainWindow);
      attachStatePublisher(mainWindow);
      attachViewedSessionTracking(mainWindow);
      void notificationPermissionService?.getCurrentStatus();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    stopNotifications?.();
    stopNotifications = undefined;
    notificationManager = undefined;
    notificationPermissionService?.dispose();
    notificationPermissionService = undefined;
    stopUpdateChecker?.();
    stopUpdateChecker = undefined;
    stopPruningTerminals?.();
    stopPruningTerminals = undefined;
    terminalService?.dispose();
    terminalService = undefined;
    stopWeixinBridgeRuntime();
    app.quit();
  }
});

app.on("before-quit", (event) => {
  stopNotifications?.();
  stopNotifications = undefined;
  notificationManager = undefined;
  notificationPermissionService?.dispose();
  notificationPermissionService = undefined;
  stopUpdateChecker?.();
  stopUpdateChecker = undefined;
  stopPruningTerminals?.();
  stopPruningTerminals = undefined;
  terminalService?.dispose();
  terminalService = undefined;
  stopWeixinBridgeRuntime();
  if (quittingAfterStoreFlush || !store) {
    return;
  }

  event.preventDefault();
  quittingAfterStoreFlush = true;
  void store
    .flushPersistence()
    .catch(() => undefined)
    .finally(() => {
      app.quit();
    });
});

function resolveInitialWorkspacePaths(): readonly string[] {
  const raw = process.env.PI_APP_INITIAL_WORKSPACES;
  if (raw !== undefined) {
    return raw
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

async function readComposerAttachment(filePath: string): Promise<ComposerAttachment> {
  const mimeType = mimeTypeForPath(filePath);
  if (mimeType.startsWith("image/")) {
    return readComposerImageAttachment(filePath, mimeType);
  }

  const stats = await stat(filePath);
  return {
    id: randomUUID(),
    kind: "file",
    name: path.basename(filePath),
    mimeType,
    fsPath: filePath,
    ...(typeof stats.size === "number" ? { sizeBytes: stats.size } : {}),
  };
}

async function readComposerImageAttachment(filePath: string, mimeType: string): Promise<ComposerImageAttachment> {
  const buffer = await readFile(filePath);
  return {
    id: randomUUID(),
    kind: "image",
    name: path.basename(filePath),
    mimeType,
    data: buffer.toString("base64"),
  };
}

function mimeTypeForPath(filePath: string): string {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  const supported = SUPPORTED_IMAGE_TYPES.find((type) => type.extension === extension);
  if (supported) {
    return supported.mimeType;
  }
  return "application/octet-stream";
}

function validateComposerAttachmentPayload(attachment: ComposerAttachment): ComposerAttachment[] {
  if (attachment.kind === "image") {
    if (typeof attachment.data !== "string" || typeof attachment.mimeType !== "string" || !SUPPORTED_IMAGE_MIME_TYPES.has(attachment.mimeType)) {
      return [];
    }
    return [
      {
        ...attachment,
        kind: "image",
      },
    ];
  }

  if (
    attachment.kind !== "file" ||
    typeof attachment.fsPath !== "string" ||
    typeof attachment.mimeType !== "string" ||
    typeof attachment.name !== "string"
  ) {
    return [];
  }

  const normalized: ComposerFileAttachment = {
    ...attachment,
    kind: "file",
    fsPath: attachment.fsPath.trim(),
    name: attachment.name.trim() || path.basename(attachment.fsPath),
  };
  if (!normalized.fsPath) {
    return [];
  }
  return [normalized];
}

function createRuntimeLoginCallbacks() {
  return {
    onAuth: async ({ url, instructions }: { readonly url: string; readonly instructions?: string }) => {
      await shell.openExternal(url);
      if (instructions) {
        await showLoginInstructions(url, instructions);
      }
    },
    onPrompt: async ({
      message,
      placeholder,
      allowEmpty,
    }: {
      readonly message: string;
      readonly placeholder?: string;
      readonly allowEmpty?: boolean;
    }) => promptForText(message, placeholder, allowEmpty),
  };
}

async function showLoginInstructions(url: string, instructions: string): Promise<void> {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const detail = `${instructions}\n\n${url}`;
  const options: MessageBoxOptions = {
    type: "info",
    title: "Provider login",
    message: "Continue provider login in your browser.",
    detail,
    buttons: ["OK"],
    defaultId: 0,
    cancelId: 0,
  };
  if (window) {
    await dialog.showMessageBox(window, options);
  } else {
    await dialog.showMessageBox(options);
  }
}

async function promptForText(message: string, placeholder = "", allowEmpty = false): Promise<string> {
  const window = mainWindow;
  if (!window || window.isDestroyed()) {
    throw new Error("Main window is not available for login.");
  }
  window.show();
  window.focus();
  const promptMessage = allowEmpty && placeholder ? `${message}\n\nExample: ${placeholder}` : message;
  const result = await window.webContents.executeJavaScript(
    `window.prompt(${JSON.stringify(promptMessage)}, ${JSON.stringify(allowEmpty ? "" : placeholder)})`,
    true,
  );
  if (typeof result !== "string") {
    throw new Error("Login cancelled.");
  }
  const normalized = result.trim();
  if (!allowEmpty && normalized.length === 0) {
    throw new Error("Login cancelled.");
  }
  return normalized;
}
