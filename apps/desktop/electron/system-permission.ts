import { app, type BrowserWindow, shell } from "electron";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { DesktopSystemPermissionsState, DesktopSystemPermissionStatus } from "../src/ipc";

const execFileAsync = promisify(execFile);
const PERMISSION_HELPER_NAME = "pi-deepseek-permission-helper";
const RECONCILIATION_POLL_INTERVAL_MS = 600;
const RECONCILIATION_MAX_POLLS = 15;

export class SystemPermissionService {
  private window: BrowserWindow | null = null;
  private stopTrackingWindow: (() => void) | undefined;
  private readonly listeners = new Set<(status: DesktopSystemPermissionsState) => void>();
  private lastPublishedStatus: DesktopSystemPermissionsState = {
    accessibility: "unknown",
    screenRecording: "unknown",
  };
  private reconciliationBaselineStatus: DesktopSystemPermissionsState | null = null;
  private reconciliationPollTimer: ReturnType<typeof setTimeout> | undefined;
  private reconciliationPollCount = 0;

  private readonly handleAppReactivation = () => {
    void this.reconcileOnActivation();
  };

  constructor(private readonly getWindow: () => BrowserWindow | null) {
    app.on("activate", this.handleAppReactivation);
    app.on("browser-window-focus", this.handleAppReactivation);
  }

  dispose(): void {
    app.off("activate", this.handleAppReactivation);
    app.off("browser-window-focus", this.handleAppReactivation);
    this.clearReconciliationPoll();
    this.trackWindow(null);
    this.listeners.clear();
  }

  trackWindow(window: BrowserWindow | null): void {
    if (window === this.window) {
      return;
    }

    this.stopTrackingWindow?.();
    this.stopTrackingWindow = undefined;
    this.window = window && !window.isDestroyed() ? window : null;
    if (!this.window) {
      return;
    }

    const handleWindowActivation = () => {
      void this.reconcileOnActivation();
    };
    const clearTrackedWindow = () => {
      this.trackWindow(null);
    };

    this.window.on("focus", handleWindowActivation);
    this.window.on("show", handleWindowActivation);
    this.window.on("restore", handleWindowActivation);
    this.window.once("closed", clearTrackedWindow);
    this.stopTrackingWindow = () => {
      this.window?.off("focus", handleWindowActivation);
      this.window?.off("show", handleWindowActivation);
      this.window?.off("restore", handleWindowActivation);
      this.window?.off("closed", clearTrackedWindow);
    };
  }

  subscribe(listener: (status: DesktopSystemPermissionsState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async getCurrentStatus(): Promise<DesktopSystemPermissionsState> {
    if (process.platform !== "darwin") {
      const unsupported: DesktopSystemPermissionsState = {
        accessibility: "unsupported",
        screenRecording: "unsupported",
      };
      this.publish(unsupported);
      return unsupported;
    }

    const helperPath = resolvePermissionHelperPath();
    if (!helperPath) {
      // Fallback detection via system command
      const fallback = await readFallbackPermissionStatus();
      this.publish(fallback);
      return fallback;
    }

    try {
      const { stdout } = await execFileAsync(helperPath, ["--check"], { env: process.env });
      const parsed = JSON.parse(stdout.trim()) as { accessibility?: unknown; screenRecording?: unknown };
      const status: DesktopSystemPermissionsState = {
        accessibility: normalizePermissionStatus(parsed.accessibility) ?? "unknown",
        screenRecording: normalizePermissionStatus(parsed.screenRecording) ?? "unknown",
      };
      this.publish(status);
      return status;
    } catch {
      const fallback = await readFallbackPermissionStatus();
      this.publish(fallback);
      return fallback;
    }
  }

  async requestPermission(type: "accessibility" | "screenRecording" | "all" = "all"): Promise<DesktopSystemPermissionsState> {
    if (process.platform !== "darwin") {
      return this.getCurrentStatus();
    }

    this.reconciliationBaselineStatus = await this.getCurrentStatus();
    this.clearReconciliationPoll();

    const helperPath = resolvePermissionHelperPath();
    const arg =
      type === "accessibility"
        ? "--request-accessibility"
        : type === "screenRecording"
          ? "--request-screen-recording"
          : "--request-all";

    if (helperPath) {
      try {
        const { stdout } = await execFileAsync(helperPath, [arg], { env: process.env });
        const parsed = JSON.parse(stdout.trim()) as { accessibility?: unknown; screenRecording?: unknown };
        const status: DesktopSystemPermissionsState = {
          accessibility: normalizePermissionStatus(parsed.accessibility) ?? "unknown",
          screenRecording: normalizePermissionStatus(parsed.screenRecording) ?? "unknown",
        };
        this.publish(status);
        this.startReconciliationPoll();
        return status;
      } catch {}
    }

    // Fallback: open system settings directly
    await this.openSystemSettings(type === "screenRecording" ? "screenRecording" : "accessibility");
    this.startReconciliationPoll();
    return this.getCurrentStatus();
  }

  async openSystemSettings(type: "accessibility" | "screenRecording"): Promise<void> {
    if (process.platform !== "darwin") {
      return;
    }

    this.reconciliationBaselineStatus = await this.getCurrentStatus();
    this.clearReconciliationPoll();

    const urls =
      type === "accessibility"
        ? [
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility",
          ]
        : [
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture",
          ];

    for (const url of urls) {
      try {
        await execFileAsync("open", [url]);
        this.startReconciliationPoll();
        return;
      } catch {}
    }

    await shell.openPath("/System/Applications/System Settings.app");
    this.startReconciliationPoll();
  }

  private async reconcileOnActivation(): Promise<void> {
    const status = await this.getCurrentStatus();
    const baseline = this.reconciliationBaselineStatus;
    if (baseline === null) {
      return;
    }
    if (
      status.accessibility !== baseline.accessibility ||
      status.screenRecording !== baseline.screenRecording
    ) {
      this.reconciliationBaselineStatus = null;
      this.clearReconciliationPoll();
      return;
    }
    this.startReconciliationPoll();
  }

  private startReconciliationPoll(): void {
    if (this.reconciliationPollTimer) {
      return;
    }

    this.reconciliationPollCount = 0;
    const tick = async () => {
      const baseline = this.reconciliationBaselineStatus;
      if (baseline === null) {
        this.clearReconciliationPoll();
        return;
      }

      const status = await this.getCurrentStatus();
      this.reconciliationPollCount += 1;
      if (
        status.accessibility !== baseline.accessibility ||
        status.screenRecording !== baseline.screenRecording ||
        this.reconciliationPollCount >= RECONCILIATION_MAX_POLLS
      ) {
        this.reconciliationBaselineStatus = null;
        this.clearReconciliationPoll();
        return;
      }

      this.reconciliationPollTimer = setTimeout(() => {
        void tick();
      }, RECONCILIATION_POLL_INTERVAL_MS);
    };

    this.reconciliationPollTimer = setTimeout(() => {
      void tick();
    }, RECONCILIATION_POLL_INTERVAL_MS);
  }

  private clearReconciliationPoll(): void {
    if (!this.reconciliationPollTimer) {
      return;
    }
    clearTimeout(this.reconciliationPollTimer);
    this.reconciliationPollTimer = undefined;
    this.reconciliationPollCount = 0;
  }

  private publish(status: DesktopSystemPermissionsState): void {
    if (
      status.accessibility === this.lastPublishedStatus.accessibility &&
      status.screenRecording === this.lastPublishedStatus.screenRecording
    ) {
      return;
    }
    this.lastPublishedStatus = status;
    for (const listener of this.listeners) {
      listener(status);
    }
  }
}

function resolvePermissionHelperPath(): string | undefined {
  if (process.platform !== "darwin") {
    return undefined;
  }

  if (app.isPackaged) {
    const packagedPath = path.join(process.resourcesPath, "..", "MacOS", PERMISSION_HELPER_NAME);
    if (existsSync(packagedPath)) {
      return packagedPath;
    }
  }

  const devPaths = [
    path.join(__dirname, "..", "build", "native", PERMISSION_HELPER_NAME),
    path.join(app.getAppPath(), "build", "native", PERMISSION_HELPER_NAME),
    path.resolve(process.cwd(), "apps/desktop/build/native", PERMISSION_HELPER_NAME),
    path.resolve(process.cwd(), "build/native", PERMISSION_HELPER_NAME),
  ];

  for (const p of devPaths) {
    if (existsSync(p)) {
      return p;
    }
  }

  return undefined;
}

async function readFallbackPermissionStatus(): Promise<DesktopSystemPermissionsState> {
  // Simple fallback detection
  let accessibility: DesktopSystemPermissionStatus = "unknown";
  try {
    const { status } = await execFileAsync("osascript", ["-e", 'tell application "System Events" to get name of first process'], { timeout: 1000 }).then(
      () => ({ status: 0 }),
      () => ({ status: 1 }),
    );
    accessibility = status === 0 ? "granted" : "denied";
  } catch {
    accessibility = "denied";
  }

  return {
    accessibility,
    screenRecording: "unknown",
  };
}

function normalizePermissionStatus(value: unknown): DesktopSystemPermissionStatus | undefined {
  switch (value) {
    case "granted":
    case "denied":
    case "default":
    case "unsupported":
    case "unknown":
      return value;
    default:
      return undefined;
  }
}
