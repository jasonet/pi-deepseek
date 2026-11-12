import { desktopIpc } from "../../desktop/src/ipc";
import { normalizeInvokeArgs } from "../../desktop-tauri/src/invoke-args";

type Handler = (...args: any[]) => void;
const listeners = new Map<string, Set<Handler>>();
const tauri = () => (window as any).__TAURI__;
const call = (method: string, args: unknown[] = []) => tauri().core.invoke("plugin:taosi|invoke", {
  method, args: normalizeInvokeArgs(args),
});

export const contextBridge = {
  exposeInMainWorld(name: string, value: unknown) {
    Object.defineProperty(window, name, { value, configurable: false });
  },
};
export const ipcRenderer = {
  invoke: (method: string, ...args: unknown[]) => call(method, args),
  send(method: string, ...args: unknown[]) { void call(method, args).catch(console.error); },
  sendSync(method: string) {
    // WebKit delivers clipboard images through the native paste event's files.
    if (method === desktopIpc.readClipboardImage) return null;
    throw new Error(`Unsupported synchronous host call: ${method}`);
  },
  on(channel: string, handler: Handler) {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel)!.add(handler);
  },
  removeListener(channel: string, handler: Handler) { listeners.get(channel)?.delete(handler); },
};
export const webUtils = { getPathForFile: () => "" };

function deliver(channel: string, ...args: unknown[]) {
  for (const handler of listeners.get(channel) ?? []) handler({}, ...args);
}

export async function initializeBridge() {
  function toFiles(attachments: any[]): DataTransfer {
    const transfer = new DataTransfer();
    for (const attachment of attachments) {
      const bytes = attachment.kind === "image" ? Uint8Array.from(atob(attachment.data), (c) => c.charCodeAt(0)) : new Uint8Array();
      const file = new File([bytes], attachment.name, { type: attachment.mimeType });
      if (attachment.fsPath) Object.defineProperty(file, "path", { value: attachment.fsPath });
      if (attachment.sizeBytes !== undefined) Object.defineProperty(file, "size", { value: attachment.sizeBytes });
      transfer.items.add(file);
    }
    return transfer;
  }
  // Native pickers preserve absolute paths, which browser File objects omit.
  document.addEventListener("click", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
    event.preventDefault();
    void call("taosi:pick-files").then((attachments) => {
      if (!attachments?.length) return;
      input.files = toFiles(attachments).files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }).catch(console.error);
  }, true);
  const notifications = new Map<string, Notification>();
  let themeSetting = "system";
  await tauri().event.listen("taosi://host", async ({ payload }: any) => {
    const { id, method, args } = payload;
    try {
      const win = tauri().webviewWindow.getCurrentWebviewWindow();
      let result: unknown = null;
      switch (method) {
        case "pickDirectory": result = await tauri().core.invoke("plugin:dialog|open", { options: { directory: true, multiple: false, title: "Open folder" } }); break;
        case "pickFiles": result = await tauri().core.invoke("plugin:dialog|open", { options: { multiple: true, title: "Attach files" } }); break;
        case "saveFile": result = await tauri().core.invoke("plugin:dialog|save", { options: { defaultPath: args[0], title: "Save file as" } }); break;
        case "prompt": result = await tauri().core.invoke("plugin:taosi|prompt", { message: args[0].message }); break;
        case "instructions": await tauri().core.invoke("plugin:dialog|message", { message: args[0], title: "Provider login", kind: "info" }); break;
        case "open": {
          const target = args[0];
          if (/^https?:/.test(target)) await tauri().core.invoke("plugin:opener|open_url", { url: target });
          else if (target.startsWith("/")) await tauri().core.invoke("plugin:opener|open_path", { path: target });
          else throw new Error("Unsupported external target");
          break;
        }
        case "theme": themeSetting = args[0]; await win.setTheme(themeSetting === "system" ? null : themeSetting); result = await win.theme(); break;
        case "show": await win.show(); break;
        case "focus": await win.setFocus(); break;
        case "restore": await win.unminimize(); break;
        case "quit": setTimeout(() => void tauri().core.invoke("quit_app"), 250); break;
        case "toggleMaximize": await win.toggleMaximize(); break;
        case "notify": {
          const notification = new Notification(args[1].title, { body: args[1].body, silent: args[1].silent });
          notifications.set(args[0], notification);
          notification.onclick = () => { void call("taosi:notification-event", [args[0], "click"]); };
          notification.onclose = () => { notifications.delete(args[0]); void call("taosi:notification-event", [args[0], "close"]); };
          break;
        }
        case "closeNotification": notifications.get(args[0])?.close(); notifications.delete(args[0]); break;
        default: throw new Error(`Unsupported native operation: ${method}`);
      }
      await tauri().core.invoke("plugin:taosi|host_response", { response: { id, ok: true, result } });
    } catch (error) {
      await tauri().core.invoke("plugin:taosi|host_response", { response: { id, ok: false, error: String(error) } });
    }
  });
  await tauri().event.listen("taosi://event", ({ payload }: any) => {
    deliver(payload.event, payload.payload, payload.sequence);
  });
  await tauri().event.listen("taosi://command", ({ payload }: any) => {
    if (payload === "open-folder") void call(desktopIpc.pickWorkspace);
    else if (payload === "check-for-update") void call(desktopIpc.checkForUpdate);
    else deliver(desktopIpc.appCommand, payload);
  });
  const win = tauri().webviewWindow.getCurrentWebviewWindow();
  await win.onDragDropEvent(({ payload }: any) => {
    if (payload.type !== "drop") return;
    const position = payload.position;
    const target = document.elementFromPoint(position.x / devicePixelRatio, position.y / devicePixelRatio);
    void call("taosi:read-files", [payload.paths]).then((attachments) => {
      target?.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: toFiles(attachments) }));
    }).catch(console.error);
  });
  await win.onThemeChanged(({ payload }: any) => {
    if (themeSetting === "system") deliver(desktopIpc.themeChanged, payload);
  });
  await call("taosi:ready");
}
