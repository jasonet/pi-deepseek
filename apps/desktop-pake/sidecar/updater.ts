import { createHash } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { isUpdateVersionNewer } from "../../desktop/electron/update-version";
import type { DesktopUpdateStatus } from "../../desktop/src/ipc";

const exec = promisify(execFile);
interface Manifest { version: string; url: string; sha256: string; }
export class PakeUpdater {
  private status: DesktopUpdateStatus;
  private manifest?: Manifest;
  private stagedApp?: string;
  private operation?: Promise<DesktopUpdateStatus>;
  private enabled = true;
  private timer?: ReturnType<typeof setInterval>;
  private initial?: ReturnType<typeof setTimeout>;
  constructor(private readonly publish: (status: DesktopUpdateStatus) => void) {
    this.status = { phase: "idle", currentVersion: process.env.PI_APP_VERSION! };
  }
  getStatus() { return this.status; }
  getEnabled() { return this.enabled; }
  setEnabled(value: boolean) { this.enabled = value; this.dispose(); if (value) this.start(); return value; }
  start() {
    this.dispose();
    if (!this.enabled || process.env.PI_APP_TEST_MODE) return;
    this.initial = setTimeout(() => { void this.check(); }, 30_000);
    this.timer = setInterval(() => { void this.check(); }, 6 * 60 * 60_000);
  }
  dispose() { clearTimeout(this.initial); clearInterval(this.timer); this.initial = undefined; this.timer = undefined; }
  private set(patch: Partial<DesktopUpdateStatus>) { this.status = { ...this.status, ...patch }; this.publish(this.status); return this.status; }
  check() {
    if (this.operation) return this.operation;
    this.operation = this.checkInternal().catch((error) => this.set({ phase: "error", message: error.message })).finally(() => { this.operation = undefined; });
    return this.operation;
  }
  private async checkInternal() {
    this.set({ phase: "checking", message: undefined });
    const url = process.env.PI_PAKE_UPDATE_FEED ?? `https://github.com/jasonet/pi-deepseek/releases/latest/download/latest-pake-${process.arch}.json`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (response.status === 404) return this.set({ phase: "unsupported", message: "A Pake update has not been published yet. This comparison build can be updated from its Pake ZIP package." });
    if (!response.ok) throw new Error(`Pake update feed returned HTTP ${response.status}`);
    const manifest = await response.json() as Manifest;
    const download = new URL(manifest.url);
    if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(manifest.version) || !/^[a-f0-9]{64}$/.test(manifest.sha256)
      || (download.protocol !== "https:" && !(process.env.PI_APP_TEST_MODE && download.hostname === "127.0.0.1"))) throw new Error("Invalid Pake update manifest");
    this.manifest = manifest;
    return this.set({ phase: isUpdateVersionNewer(manifest.version, this.status.currentVersion) ? "available" : "up-to-date", latestVersion: manifest.version });
  }
  async download() {
    if (this.operation) return this.operation;
    this.operation = this.downloadInternal().catch((error) => this.set({ phase: "error", message: error.message })).finally(() => { this.operation = undefined; });
    return this.operation;
  }
  private async downloadInternal() {
    if (!this.manifest || this.status.phase !== "available") throw new Error("Check for a newer Pake version first");
    const manifest = this.manifest;
    this.set({ phase: "downloading", percent: 0 });
    const response = await fetch(manifest.url, { signal: AbortSignal.timeout(10 * 60_000) });
    if (!response.ok || !response.body) throw new Error(`Pake update download failed: HTTP ${response.status}`);
    const destination = path.join(process.env.PI_APP_USER_DATA_DIR!, "updates", `${manifest.version}-${Date.now()}`);
    await mkdir(destination, { recursive: true, mode: 0o700 });
    const file = path.join(destination, "update.zip");
    const { open } = await import("node:fs/promises");
    const handle = await open(file, "wx", 0o600);
    const hash = createHash("sha256");
    const total = Number(response.headers.get("content-length")) || undefined;
    let transferred = 0;
    let lastProgress = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        await handle.write(chunk); hash.update(chunk); transferred += chunk.length;
        if (transferred > 1024 * 1024 * 1024) throw new Error("Pake update exceeds 1 GB");
        if (Date.now() - lastProgress > 200) {
          lastProgress = Date.now();
          this.set({ phase: "downloading", transferred, total, percent: total ? 100 * transferred / total : undefined });
        }
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); await handle.close(); }
    if (hash.digest("hex") !== manifest.sha256) throw new Error("Pake update checksum verification failed");
    await exec("/usr/bin/ditto", ["-x", "-k", file, destination]);
    const app = path.join(destination, "Taosi-Pake.app");
    const plist = path.join(app, "Contents/Info.plist");
    const { stdout: id } = await exec("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", plist]);
    const { stdout: version } = await exec("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", plist]);
    if (id.trim() !== "com.pi-deepseek.pake" || version.trim() !== manifest.version) throw new Error("Pake update identity does not match");
    await exec("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
    this.stagedApp = app;
    return this.set({ phase: "ready", percent: 100 });
  }
  async install() {
    if (!this.stagedApp || this.status.phase !== "ready") throw new Error("Download a verified Pake update first");
    const current = path.resolve(process.env.PI_APP_RESOURCES_DIR!, "../..");
    const { stdout: id } = await exec("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", path.join(current, "Contents/Info.plist")]);
    if (id.trim() !== "com.pi-deepseek.pake") throw new Error("Refusing to replace a different application");
    const script = path.join(process.env.PI_APP_USER_DATA_DIR!, "updates", `install-${Date.now()}.sh`);
    await writeFile(script, '#!/bin/sh\nset -eu\nstage="$2.next-$(date +%s).app"\nditto "$3" "$stage"\ncodesign --verify --deep --strict "$stage"\nwhile kill -0 "$1" 2>/dev/null; do sleep 1; done\nbackup="$2.previous-$(date +%s)"\nmv "$2" "$backup"\nif ! mv "$stage" "$2"; then mv "$backup" "$2"; exit 1; fi\nopen "$2"\n', { mode: 0o700 });
    const child = spawn("/bin/sh", [script, String(process.pid), current, this.stagedApp], { detached: true, stdio: "ignore" });
    child.unref();
  }
}
