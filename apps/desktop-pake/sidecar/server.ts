import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  store, handlers, emitEvent, main, sidecarHooks, setHostWindow,
  runtimeLoginCallbacks, dshHarnessService, dsBotService,
} from "../../desktop-tauri/sidecar/server";
import { configureHost, hostWindow, nativeCall, receiveHostMessage, resourcePath } from "./host";
import { desktopIpc } from "../../desktop/src/ipc";
import { TerminalService } from "../../desktop/electron/terminal-service";
import { NotificationManager } from "../../desktop/electron/notification-manager";
import { NotificationPermissionService } from "../../desktop/electron/notification-permission";
import { SystemPermissionService } from "../../desktop/electron/system-permission";
import { RendererPublisher } from "../../desktop/electron/renderer-publisher";
import { rendererTranscript } from "../../desktop/electron/renderer-transcript";
import { previewWorkspaceFile, saveWorkspaceFileAs } from "../../desktop/electron/app-store-file-preview";
import { ensurePathForGuiLaunch } from "../../desktop/electron/ensure-path";
import { DshWebService, ensureHarnessProfile, resolveActiveDeepSeekKey } from "../../desktop/electron/dsh-web-service";
import { ensureTradingRuntime } from "../../desktop/electron/dsh-trading-runtime";
import { readTradingPreferences, saveTradingPreferences } from "../../desktop/electron/dsh-trading-preferences";
import { DSH_FREE_MODEL_ARCHIVE, getDshFreeModelStatus, setDshFreeModelConfig } from "../../desktop/electron/dsh-our-free-model";
import { pollFeishuInstall, pollWeixinInstall, startFeishuInstallQrcode, startWeixinInstallQrcode } from "../../desktop/electron/connect-phone-install";
import { createImWebhookServer } from "../../desktop/electron/im-webhook-server";
import { configureWeixinBridgeRuntimeContextProvider, ensureWeixinBridgeRpcUrl, stopWeixinBridgeRuntime } from "../../desktop/electron/weixin-bridge-runtime";
import { readComposerAttachment as readAttachment, validateComposerAttachmentPayload } from "../../desktop/electron/composer-attachment-files";
import { isFxAuthProvider } from "../../desktop/src/fx-auth";
import type { ComposerAttachment } from "../../desktop/src/desktop-state";
import { PakeUpdater } from "./updater";

ensurePathForGuiLaunch();
configureHost((event, payload, sequence) => emitEvent(event, payload, sequence));
setHostWindow(hostWindow);
sidecarHooks.message = receiveHostMessage;
const windowForServices = hostWindow as any;
const terminal = new TerminalService({
  getWorkspacePath: (id) => store.getWorkspacePath(id),
  getIntegratedTerminalShell: () => store.state.integratedTerminalShell,
  isPackaged: true,
});
const owner = hostWindow.webContents as any;
const notificationPermissions = new NotificationPermissionService(() => windowForServices);
const systemPermissions = new SystemPermissionService(() => windowForServices);
const notifications = new NotificationManager(store, () => windowForServices, notificationPermissions);
notificationPermissions.trackWindow(windowForServices);
systemPermissions.trackWindow(windowForServices);
notifications.trackWindow(windowForServices);
notificationPermissions.subscribe((status) => emitEvent(desktopIpc.notificationPermissionStatusChanged, status));
systemPermissions.subscribe((status) => emitEvent(desktopIpc.systemPermissionsStatusChanged, status));

const home = process.env.PI_APP_USER_DATA_DIR!;
const tradingHome = path.join(home, "dsh-trading");
const trading = new DshWebService({
  runtimeRoot: path.join(home, "trading-runtime"), dshHome: tradingHome,
  workingDirectory: path.join(tradingHome, "research"), isolateCredentials: true,
  profile: "trading-web", title: "DSH Trading", externalUrl: "",
  childEnvironment: { DSH_DESKTOP_SHELL_PID: String(process.pid) },
  install: (root, signal, report) => ensureTradingRuntime(root, signal, report, {
    resources: resourcePath("trading"), nodeRoot: path.join(home, "harness"),
    dshHome: tradingHome, parentOrigin: "tauri://localhost",
  }),
});
const service = (mode?: string) => {
  if (mode === "trading") return trading;
  if (mode === "bot") return dsBotService;
  if (mode === undefined || mode === "harness") return dshHarnessService;
  throw new Error("Unknown DSH service");
};
const freeModelArchivePath = resourcePath("extensions", DSH_FREE_MODEL_ARCHIVE);
const processes = new Map<string, ReturnType<typeof spawn>>();
let theme: "system" | "light" | "dark" = "system";
const updater = new PakeUpdater((status) => emitEvent(desktopIpc.updateStatusChanged, status));

function workspace(id: string) {
  const result = store.getWorkspacePath(id);
  if (!result) throw new Error(`Unknown workspace: ${id}`);
  return result;
}

Object.assign(runtimeLoginCallbacks, {
  onAuth: async ({ url, instructions }: { url: string; instructions?: string }) => {
    await nativeCall("open", [url]);
    if (instructions) await nativeCall("instructions", [instructions]);
  },
  onPrompt: async (prompt: { message: string; placeholder?: string; allowEmpty?: boolean }) => {
    const value: string | null = await nativeCall("prompt", [prompt]);
    if (value === null || (!prompt.allowEmpty && !value.trim())) throw new Error("Login cancelled");
    return value.trim();
  },
});

Object.assign(handlers, {
  [desktopIpc.addComposerAttachments]: (attachments: ComposerAttachment[]) => store.addComposerAttachments(attachments.flatMap(validateComposerAttachmentPayload)),
  [desktopIpc.getUpdateStatus]: () => updater.getStatus(),
  [desktopIpc.checkForUpdate]: () => updater.check(),
  [desktopIpc.downloadUpdate]: () => updater.download(),
  [desktopIpc.installUpdate]: async () => { await updater.install(); await nativeCall("quit"); },
  [desktopIpc.setAutoUpdateEnabled]: (enabled: boolean) => updater.setEnabled(enabled),
  [desktopIpc.getAutoUpdateEnabled]: () => updater.getEnabled(),
  "taosi:notification-event": (id: string, event: string) => receiveHostMessage({ kind: "notification", id, event }),
  "taosi:ready": async () => { await store.initialize(); return { version: process.env.PI_APP_VERSION }; },
  "taosi:read-files": (paths: string[]) => Promise.all(paths.map(readAttachment)),
  "taosi:pick-files": async () => {
    const paths: string[] | null = await nativeCall("pickFiles");
    return paths ? Promise.all(paths.map(readAttachment)) : [];
  },
  [desktopIpc.getFxAuthStatus]: (id: string) => store.getFxAuthStatus(id),
  [desktopIpc.loginFxProvider]: (id: string, provider: unknown) => {
    if (!isFxAuthProvider(provider)) throw new Error("Unsupported FX provider");
    return store.loginFxProvider(id, provider);
  },
  [desktopIpc.selectFxProvider]: (id: string, provider: unknown) => {
    if (!isFxAuthProvider(provider)) throw new Error("Unsupported FX provider");
    return store.selectFxProvider(id, provider);
  },
  [desktopIpc.cancelCurrentRunFor]: (target: any) => store.cancelCurrentRunFor(target),
  [desktopIpc.pickWorkspace]: async () => {
    const file = await nativeCall("pickDirectory");
    if (!file) return store.getState();
    const state = await store.addWorkspace(file);
    emitEvent(desktopIpc.workspacePicked, state.selectedWorkspaceId);
    return state;
  },
  [desktopIpc.pickComposerAttachments]: async () => {
    const files = await nativeCall("pickFiles");
    return files ? store.addComposerAttachments(await Promise.all(files.map(readAttachment))) : store.getState();
  },
  [desktopIpc.previewWorkspaceFile]: (id: string, file: string) => previewWorkspaceFile(workspace(id), file),
  [desktopIpc.saveWorkspaceFileAs]: async (id: string, file: string) => {
    const destination = await nativeCall("saveFile", [path.basename(file)]);
    if (!destination) return false;
    await saveWorkspaceFileAs(workspace(id), file, destination);
    return true;
  },
  [desktopIpc.terminalEnsurePanel]: (id: string, scope: string, size: any) => terminal.ensurePanel(owner, id, scope, size),
  [desktopIpc.terminalCreateSession]: (id: string, scope: string, size: any) => terminal.createSession(owner, id, scope, size),
  [desktopIpc.terminalSetActiveSession]: (id: string, scope: string, terminalId: string) => terminal.setActiveSession(owner, id, scope, terminalId),
  [desktopIpc.terminalWrite]: (id: string, data: string) => terminal.write(owner, id, data),
  [desktopIpc.terminalResize]: (id: string, size: any) => terminal.resize(owner, id, size),
  [desktopIpc.terminalRestartSession]: (id: string, size: any) => terminal.restart(owner, id, size),
  [desktopIpc.terminalCloseSession]: (id: string) => terminal.close(owner, id),
  [desktopIpc.terminalSetTitle]: (id: string, title: string) => terminal.setTitle(owner, id, title),
  [desktopIpc.runCodeBlock]: (code: string, cwd: string) => {
    const runId = randomUUID();
    const child = spawn("/bin/bash", ["-c", code], { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    processes.set(runId, child);
    const output = (payload: object) => emitEvent(desktopIpc.runCodeBlockOutput, { runId, ...payload });
    child.stdout.on("data", (chunk) => output({ chunk: chunk.toString() }));
    child.stderr.on("data", (chunk) => output({ chunk: chunk.toString() }));
    child.on("error", (error) => { processes.delete(runId); output({ error: error.message }); });
    child.on("exit", (exitCode) => { processes.delete(runId); output({ exitCode: exitCode ?? -1 }); });
    return runId;
  },
  [desktopIpc.runCodeBlockAbort]: (id: string) => { processes.get(id)?.kill("SIGTERM"); processes.delete(id); },
  [desktopIpc.getNotificationPermissionStatus]: () => notificationPermissions.getCurrentStatus(),
  [desktopIpc.requestNotificationPermission]: () => notificationPermissions.requestPermission(),
  [desktopIpc.openSystemNotificationSettings]: () => notificationPermissions.openSystemSettings(),
  [desktopIpc.getSystemPermissionsStatus]: () => systemPermissions.getCurrentStatus(),
  [desktopIpc.requestSystemPermission]: (type: any) => systemPermissions.requestPermission(type),
  [desktopIpc.openSystemPermissionSettings]: (type: any) => systemPermissions.openSystemSettings(type),
  [desktopIpc.getThemeMode]: () => theme,
  [desktopIpc.getResolvedTheme]: () => nativeCall("theme", [theme]),
  [desktopIpc.setThemeMode]: async (mode: typeof theme) => {
    if (!["system", "light", "dark"].includes(mode)) throw new Error("Invalid theme");
    theme = mode; const resolved = await nativeCall("theme", [mode]);
    emitEvent(desktopIpc.themeChanged, resolved); return mode;
  },
  [desktopIpc.toggleWindowMaximize]: () => nativeCall("toggleMaximize"),
  [desktopIpc.getTradingPreferences]: () => readTradingPreferences(tradingHome),
  [desktopIpc.setTradingPreferences]: (input: unknown) => saveTradingPreferences(tradingHome, input),
  [desktopIpc.getDshWebStatus]: (mode?: string) => service(mode).getStatus(),
  [desktopIpc.startDshWeb]: (mode?: string) => service(mode).start(),
  [desktopIpc.launchDshWeb]: (mode?: string) => service(mode).launch(),
  [desktopIpc.restartDshWeb]: (mode?: string) => service(mode).restart(),
  [desktopIpc.stopDshWeb]: (mode?: string) => service(mode).stop(),
  [desktopIpc.getDshOurFreeModelStatus]: () => getDshFreeModelStatus({ archivePath: freeModelArchivePath, dshHome: path.join(home, "dsh-harness") }),
  [desktopIpc.setDshOurFreeModelConfig]: async (input: any) => {
    const options = { archivePath: freeModelArchivePath, dshHome: path.join(home, "dsh-harness") };
    const previous = await getDshFreeModelStatus(options);
    if (previous.enabled === input?.enabled && previous.mode === input?.mode) return previous;
    const current = await dshHarnessService.getStatus();
    if (["starting", "installing", "launching"].includes(current.state)) throw new Error("Wait for DeepSeek Harness startup to complete");
    const restart = current.state === "running" && current.managed;
    if (restart) await dshHarnessService.stop();
    try {
      await ensureHarnessProfile(options.dshHome);
      const result = await setDshFreeModelConfig(input, { ...options, hasDeepSeekKey: Boolean(await resolveActiveDeepSeekKey(options.dshHome)) });
      if (restart) { const next = await dshHarnessService.start(); if (next.state === "error") throw new Error(next.message); }
      return result;
    } catch (error) {
      if (restart && (await dshHarnessService.getStatus()).state === "idle") await dshHarnessService.start();
      throw error;
    }
  },
  [desktopIpc.startConnectPhoneQr]: (input: any) => input.provider === "weixin" ? startWeixinInstallQrcode(fetch) : startFeishuInstallQrcode(fetch, input.isLark),
  [desktopIpc.pollConnectPhoneQr]: (provider: string, code: string) => provider === "weixin" ? pollWeixinInstall(fetch, code) : pollFeishuInstall(fetch, code),
});

// Retain the Electron contract's event names and snapshot backpressure.
sidecarHooks.publish = () => {
  const statePublisher = new RendererPublisher<any>((payload, sequence) => emitEvent(desktopIpc.stateChanged, payload, sequence));
  const transcriptPublisher = new RendererPublisher<any>((payload, sequence) => emitEvent(desktopIpc.selectedTranscriptChanged, payload, sequence));
  handlers["taosi:ready"] = () => {
    statePublisher.reset(); transcriptPublisher.reset();
    return { version: process.env.PI_APP_VERSION };
  };
  let terminalPaths = "";
  handlers[desktopIpc.rendererSnapshotAcknowledged] = (channel, sequence) => {
    (channel === desktopIpc.stateChanged ? statePublisher : transcriptPublisher).acknowledge(sequence);
  };
  store.subscribe(() => {
    const paths = store.state.workspaces.map((w) => w.path);
    const signature = paths.join("\0");
    if (signature !== terminalPaths) { terminalPaths = signature; terminal.retainWorkspacePaths(paths); }
    statePublisher.push(() => store.state);
  });
  store.subscribeToSelectedTranscript(() => transcriptPublisher.push(() => {
    const payload = store.getSelectedTranscriptSnapshot();
    return payload && { ...payload, transcript: rendererTranscript(payload.transcript) };
  }));
};
handlers[desktopIpc.selectedTranscriptRequest] = async () => {
  const value = await store.getSelectedTranscript();
  return value && { ...value, transcript: rendererTranscript(value.transcript) };
};

const webhook = createImWebhookServer(store);
sidecarHooks.shutdown = async () => {
  updater.dispose();
  terminal.dispose();
  for (const child of processes.values()) child.kill("SIGTERM");
  notificationPermissions.dispose(); systemPermissions.dispose();
  await trading.shutdown();
  await stopWeixinBridgeRuntime();
  await webhook.stop();
};

async function boot() {
  await main();
  updater.start();
  notifications.start();
  await webhook.start();
  configureWeixinBridgeRuntimeContextProvider(async () => ({ webhookUrl: `http://127.0.0.1:${webhook.port}/im/webhook`, webhookSecret: process.env.IM_WEBHOOK_SECRET?.trim() || "", channelId: "pi-deepseek-weixin" }));
  void ensureWeixinBridgeRpcUrl().catch((error) => console.error("Weixin bridge:", error.message));
}
void boot().catch((error) => { console.error(error); process.exit(1); });
