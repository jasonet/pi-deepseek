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
import type { DesktopAppState, ThemeMode } from "../src/desktop-state";
import { desktopIpc, getDesktopCommandFromShortcut, type OpenDesignStatus } from "../src/ipc";
import { SUPPORTED_COMPOSER_IMAGE_TYPES } from "../src/composer-attachments";
import type {
  ComposerAttachment,
  ComposerFileAttachment,
  ComposerImageAttachment,
  CreateSessionInput,
  CreateWorktreeInput,
  RemoveWorktreeInput,
  StartThreadInput,
  WorkspaceSessionTarget,
} from "../src/desktop-state";
import type { SessionDriverEvent } from "@pi-gui/session-driver";
import type { GenerateThreadTitleOptions } from "@pi-gui/pi-sdk-driver";
import type { WorkspaceRef } from "@pi-gui/session-driver";
import { autoUpdater } from "electron-updater";

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
let autoUpdateEnabled = true;
let autoUpdateInterval: ReturnType<typeof setInterval> | undefined;
let skipAutoTitle = false;
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
const OPEN_DESIGN_DEFAULT_WEB_URL = "http://127.0.0.1:3000";

interface OpenDesignConfig {
  readonly daemonUrl: string;
  readonly webUrl: string;
}

async function readOpenDesignConfig(): Promise<OpenDesignConfig> {
  const envDaemonUrl = process.env.OPEN_DESIGN_DAEMON_URL?.trim();
  const envWebUrl = process.env.OPEN_DESIGN_WEB_URL?.trim();
  let daemonUrl = envDaemonUrl || OPEN_DESIGN_DEFAULT_DAEMON_URL;
  let webUrl = envWebUrl || OPEN_DESIGN_DEFAULT_WEB_URL;

  if (envDaemonUrl && envWebUrl) {
    return { daemonUrl, webUrl };
  }

  const roots = new Set([
    process.cwd(),
    app.getAppPath(),
    path.resolve(app.getAppPath(), ".."),
    path.resolve(app.getAppPath(), "..", ".."),
    path.resolve(app.getAppPath(), "..", "..", ".."),
    path.resolve(__dirname, "..", "..", "..", ".."),
  ]);

  for (const root of roots) {
    const manifestPath = path.join(root, ".pi", "extensions", OPEN_DESIGN_EXTENSION_ID, "open-design.manifest.json");
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        daemon?: { defaultUrl?: string; defaultWebUrl?: string };
      };
      daemonUrl = envDaemonUrl || manifest.daemon?.defaultUrl || daemonUrl;
      webUrl = envWebUrl || manifest.daemon?.defaultWebUrl || webUrl;
      break;
    } catch {
      // Keep scanning plausible dev/package roots.
    }
  }

  return { daemonUrl, webUrl };
}

async function fetchOpenDesignJson(url: string): Promise<unknown> {
  const response = await net.fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function getOpenDesignStatus(): Promise<OpenDesignStatus> {
  const config = await readOpenDesignConfig();
  try {
    await fetchOpenDesignJson(`${config.daemonUrl}/api/health`);
    let version: string | undefined;
    try {
      const versionResponse = await fetchOpenDesignJson(`${config.daemonUrl}/api/version`) as { version?: unknown; openDesignVersion?: unknown };
      version = typeof versionResponse.version === "string"
        ? versionResponse.version
        : typeof versionResponse.openDesignVersion === "string"
          ? versionResponse.openDesignVersion
          : undefined;
    } catch {
      version = undefined;
    }
    return { ...config, reachable: true, version };
  } catch (error) {
    return {
      ...config,
      reachable: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function startOpenDesign(): Promise<OpenDesignStatus> {
  const currentStatus = await getOpenDesignStatus();
  if (currentStatus.reachable) {
    return currentStatus;
  }

  const daemonUrl = new URL(currentStatus.daemonUrl);
  const port = daemonUrl.port || "7456";
  // Default: use the bundled plugin launcher (auto-installs on first run)
  if (!envDaemonUrl && !envWebUrl) {
    const installScript = path.join(__dirname, "..", "..", "..", "..", ".pi", "extensions", OPEN_DESIGN_EXTENSION_ID, "bin", "od-install");
    if (existsSync(installScript)) {
      process.env.OPEN_DESIGN_OD_BIN = installScript;
    }
  }

  const binary = process.env.OPEN_DESIGN_OD_BIN?.trim() || "od";

  // Validate the binary exists
  const binaryExists = existsSync(binary) || (() => {
    try {
      const which = spawnSync("which", [binary], { timeout: 3000 });
      return which.status === 0 && which.stdout.toString().trim().length > 0;
    } catch { return false; }
  })();
  if (!binaryExists) {
    return { ...currentStatus, reachable: false, message: `Open Design binary "${binary}" not found. Install it or set OPEN_DESIGN_OD_BIN.` };
  }

  const child = spawn(binary, ["--port", port, "--no-open"], {
    detached: true,
    env: { ...process.env, OD_PORT: port },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Check for immediate startup failure
  const startupResult = await Promise.race([
    new Promise<string | null>((resolve) => {
      child.stderr?.on("data", (data: Buffer) => resolve(data.toString()));
      child.stdout?.on("data", (data: Buffer) => resolve(data.toString()));
    }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
  ]);

  if (startupResult && !startupResult.includes("listening") && !startupResult.includes("started")) {
    child.kill();
    return { ...currentStatus, reachable: false, message: `Open Design failed to start: ${startupResult.slice(0, 200)}` };
  }

  child.unref();

  const deadline = Date.now() + 12_000;
  let latestStatus = currentStatus;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    latestStatus = await getOpenDesignStatus();
    if (latestStatus.reachable) {
      return latestStatus;
    }
  }

  return {
    ...latestStatus,
    message: latestStatus.message || `Started ${binary}, but ${currentStatus.daemonUrl} did not become reachable in time.`,
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
      const result = await autoUpdater.checkForUpdates();
      if (result?.updateInfo?.version) {
        const latest = result.updateInfo.version;
        if (latest !== app.getVersion()) {
          await autoUpdater.downloadUpdate();
        }
      }
    } catch {}
  }, 4 * 60 * 60 * 1000); // Check every 4 hours
  // Also check immediately on first start
  setTimeout(async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      if (result?.updateInfo?.version) {
        const latest = result.updateInfo.version;
        if (latest !== app.getVersion()) {
          await autoUpdater.downloadUpdate();
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
    if (canPublishToWindow(window)) {
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
    { role: "windowMenu" },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.setName("pi");

const configuredUserDataDir = process.env.PI_APP_USER_DATA_DIR?.trim() || app.getPath("userData").replace(/\/pi$/, "/pi-deepseek");
app.setPath("userData", configuredUserDataDir);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
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
  ipcMain.handle(desktopIpc.startOpenDesign, () => startOpenDesign());
  ipcMain.handle(desktopIpc.openOpenDesignExternal, async () => {
    const status = await getOpenDesignStatus();
    return shell.openExternal(status.webUrl);
  });
  ipcMain.handle(desktopIpc.stateRequest, () => store.getState());
  ipcMain.handle(desktopIpc.selectedTranscriptRequest, () => store.getSelectedTranscript());
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
      const result = await autoUpdater.checkForUpdates();
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
      await autoUpdater.downloadUpdate();
      return { status: "downloaded" };
    } catch (e: any) {
      return { status: "error", message: e.message };
    }
  });
  ipcMain.handle(desktopIpc.installUpdate, async () => {
    autoUpdater.quitAndInstall();
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
    onAuth: async ({ url, instructions: _instructions }: { readonly url: string; readonly instructions?: string }) => {
      await shell.openExternal(url);
    },
    onPrompt: async ({ message, placeholder }: { readonly message: string; readonly placeholder?: string }) =>
      promptForText(message, placeholder),
  };
}

async function promptForText(message: string, placeholder = ""): Promise<string> {
  const window = mainWindow;
  if (!window || window.isDestroyed()) {
    throw new Error("Main window is not available for login.");
  }
  window.show();
  window.focus();
  const result = await window.webContents.executeJavaScript(
    `window.prompt(${JSON.stringify(message)}, ${JSON.stringify(placeholder)})`,
    true,
  );
  if (typeof result !== "string" || result.trim().length === 0) {
    throw new Error("Login cancelled.");
  }
  return result.trim();
}
