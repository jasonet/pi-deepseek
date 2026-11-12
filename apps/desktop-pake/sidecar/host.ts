import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import path from "node:path";

const pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
export function nativeCall(method: string, args: unknown[] = []): Promise<any> {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Native ${method} timed out`)); }, 5 * 60_000);
    pending.set(id, { resolve, reject, timer });
    process.stdout.write(JSON.stringify({ kind: "host", id, method, args }) + "\n");
  });
}
let sendEvent: (event: string, payload: unknown, sequence?: number) => void = () => {};
export function configureHost(send: typeof sendEvent) { sendEvent = send; }

class HostWindow extends EventEmitter {
  private focused = false;
  private visible = true;
  private minimized = false;
  readonly webContents = {
    id: 1,
    isDestroyed: () => false,
    send: (event: string, payload: unknown, sequence?: number) => sendEvent(event, payload, sequence),
    executeJavaScript: (_script: string) => Promise.reject(new Error("Page evaluation is not exposed by the Pake host")),
  };
  isDestroyed() { return false; }
  isFocused() { return this.focused; }
  isVisible() { return this.visible; }
  isMinimized() { return this.minimized; }
  show() { void nativeCall("show"); }
  focus() { void nativeCall("focus"); }
  restore() { void nativeCall("restore"); }
  update(value: { focused: boolean; visible: boolean; minimized: boolean }) {
    const previous = { focused: this.focused, visible: this.visible, minimized: this.minimized };
    this.focused = value.focused; this.visible = value.visible; this.minimized = value.minimized;
    if (previous.focused !== this.focused) this.emit(this.focused ? "focus" : "blur");
    if (previous.visible !== this.visible) this.emit(this.visible ? "show" : "hide");
    if (previous.minimized !== this.minimized) this.emit(this.minimized ? "minimize" : "restore");
  }
}
export const hostWindow = new HostWindow();
export const app = Object.assign(new EventEmitter(), {
  isPackaged: true,
  getAppPath: () => process.env.PI_APP_RESOURCES_DIR!,
  getPath: () => process.env.PI_APP_USER_DATA_DIR!,
});
export const shell = {
  openExternal: (url: string) => nativeCall("open", [url]),
  openPath: (file: string) => nativeCall("open", [file]),
};
const notifications = new Map<string, Notification>();
export class Notification extends EventEmitter {
  readonly id = randomUUID();
  constructor(private options: { title: string; body: string; silent?: boolean }) { super(); notifications.set(this.id, this); }
  static isSupported() { return process.platform === "darwin"; }
  show() { void nativeCall("notify", [this.id, this.options]).catch((error) => this.emit("failed", error)); }
  close() { void nativeCall("closeNotification", [this.id]); notifications.delete(this.id); this.emit("close"); }
}

export function receiveHostMessage(value: any): boolean {
  if (value.kind === "host-response") {
    const request = pending.get(value.id);
    if (request) { clearTimeout(request.timer); pending.delete(value.id); value.ok ? request.resolve(value.result) : request.reject(new Error(value.error)); }
    return true;
  }
  if (value.kind === "window") { hostWindow.update(value); return true; }
  if (value.kind === "notification") {
    const notification = notifications.get(value.id);
    if (value.event === "close") notifications.delete(value.id);
    notification?.emit(value.event);
    return true;
  }
  return false;
}

// The existing permission services resolve their signed helpers relative to Resources.
Object.defineProperty(process, "resourcesPath", { value: process.env.PI_APP_RESOURCES_DIR });
export const resourcePath = (...parts: string[]) => path.join(process.env.PI_APP_RESOURCES_DIR!, ...parts);
