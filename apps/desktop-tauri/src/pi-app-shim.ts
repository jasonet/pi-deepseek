/**
 * Installs `window.piApp` for the Tauri build by translating the Electron
 * preload contract (apps/desktop/electron/preload.ts) onto the Tauri bridge:
 *   - method calls  -> invoke("pi_invoke", { method: <ipc channel>, args })
 *   - store events  -> the Rust bridge emits "pi://event" with { event, payload }
 *
 * Must be imported (and `installPiApp()` awaited) before React renders so the
 * renderer's `useDesktopAppState` boot sees a populated `window.piApp`.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { desktopIpc } from "../../desktop/src/ipc";

type Listener = (payload: any) => void;

const listeners = new Map<string, Set<Listener>>();

function subscribe(eventName: string, listener: Listener): () => void {
  let set = listeners.get(eventName);
  if (!set) {
    set = new Set();
    listeners.set(eventName, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
  };
}

function dispatchEvent(eventName: string, payload: unknown): void {
  const set = listeners.get(eventName);
  if (!set) return;
  for (const listener of set) {
    try {
      listener(payload);
    } catch (error) {
      console.error(`piApp event listener for ${eventName} threw`, error);
    }
  }
}

/** Fire a desktop IPC channel through the sidecar bridge. */
function call<T = unknown>(channel: string) {
  return (...args: unknown[]): Promise<T> =>
    invoke<T>("pi_invoke", { method: channel, args }) as Promise<T>;
}

export async function installPiApp(): Promise<void> {
  // Route bridge events to registered listeners.
  await listen<{ event: string; payload: unknown }>("pi://event", (message) => {
    const { event, payload } = message.payload ?? ({} as any);
    if (typeof event === "string") {
      dispatchEvent(event, payload);
    }
  });

  const piApp = {
    platform: navigatorPlatform(),
    versions: {} as Record<string, string>,

    ping: call<string>(desktopIpc.ping),

    getState: call(desktopIpc.stateRequest),
    onStateChanged: (listener: Listener) => subscribe("stateChanged", listener),

    getSelectedTranscript: call(desktopIpc.selectedTranscriptRequest),
    onSelectedTranscriptChanged: (listener: Listener) =>
      subscribe("selectedTranscriptChanged", listener),

    onCommand: (listener: Listener) => subscribe("command", listener),
    onWorkspacePicked: (listener: Listener) => subscribe("workspacePicked", listener),
    onClipboardImagePasted: (listener: Listener) => subscribe("clipboardImagePasted", listener),

    // webUtils.getPathForFile has no Tauri equivalent; drag-drop path resolution
    // is handled separately. Return empty so callers fall back gracefully.
    getPathForFile: (_file: File): string => "",

    addWorkspacePath: call(desktopIpc.addWorkspacePath),
    pickWorkspace: call(desktopIpc.pickWorkspace),
    selectWorkspace: call(desktopIpc.selectWorkspace),
    renameWorkspace: call(desktopIpc.renameWorkspace),
    removeWorkspace: call(desktopIpc.removeWorkspace),
    reorderWorkspaces: call(desktopIpc.reorderWorkspaces),
    openWorkspaceInFinder: call(desktopIpc.openWorkspaceInFinder),
    createWorktree: call(desktopIpc.createWorktree),
    removeWorktree: call(desktopIpc.removeWorktree),
    openSkillInFinder: call(desktopIpc.openSkillInFinder),
    openExtensionInFinder: call(desktopIpc.openExtensionInFinder),
    syncCurrentWorkspace: call(desktopIpc.syncCurrentWorkspace),
    selectSession: call(desktopIpc.selectSession),
    archiveSession: call(desktopIpc.archiveSession),
    unarchiveSession: call(desktopIpc.unarchiveSession),
    createSession: call(desktopIpc.createSession),
    startThread: call(desktopIpc.startThread),
    cancelCurrentRun: call(desktopIpc.cancelCurrentRun),
    setActiveView: call(desktopIpc.setActiveView),
    setSidebarCollapsed: call(desktopIpc.setSidebarCollapsed),
    setWorkspaceCollapsed: call(desktopIpc.setWorkspaceCollapsed),
    setArchivedSectionExpanded: call(desktopIpc.setArchivedSectionExpanded),
    refreshRuntime: call(desktopIpc.refreshRuntime),
    setModelSettingsScopeMode: call(desktopIpc.setModelSettingsScopeMode),
    setDefaultModel: call(desktopIpc.setDefaultModel),
    setDefaultThinkingLevel: call(desktopIpc.setDefaultThinkingLevel),
    setSessionModel: call(desktopIpc.setSessionModel),
    setSessionThinkingLevel: call(desktopIpc.setSessionThinkingLevel),
    loginProvider: call(desktopIpc.loginProvider),
    logoutProvider: call(desktopIpc.logoutProvider),
    setProviderApiKey: call(desktopIpc.setProviderApiKey),
    setEnableSkillCommands: call(desktopIpc.setEnableSkillCommands),
    setScopedModelPatterns: call(desktopIpc.setScopedModelPatterns),
    setSkillEnabled: call(desktopIpc.setSkillEnabled),
    setExtensionEnabled: call(desktopIpc.setExtensionEnabled),
    respondToHostUiRequest: call(desktopIpc.respondToHostUiRequest),
    setNotificationPreferences: call(desktopIpc.setNotificationPreferences),
    saveImChannel: call(desktopIpc.saveImChannel),
    removeImChannel: call(desktopIpc.removeImChannel),
    updateImChannelSession: call(desktopIpc.updateImChannelSession),
    startConnectPhoneQr: call(desktopIpc.startConnectPhoneQr),
    pollConnectPhoneQr: call(desktopIpc.pollConnectPhoneQr),
    setIntegratedTerminalShell: call(desktopIpc.setIntegratedTerminalShell),
    setEnableTransparency: call(desktopIpc.setEnableTransparency),
    setLocale: call(desktopIpc.setLocale),
    getLocale: call(desktopIpc.getLocale),
    getProviderBalance: call(desktopIpc.getProviderBalance),
    checkForUpdate: call(desktopIpc.checkForUpdate),
    downloadUpdate: call(desktopIpc.downloadUpdate),
    installUpdate: call(desktopIpc.installUpdate),
    setAutoUpdateEnabled: call(desktopIpc.setAutoUpdateEnabled),
    getAutoUpdateEnabled: call(desktopIpc.getAutoUpdateEnabled),
    setSkipAutoTitle: call(desktopIpc.setSkipAutoTitle),
    getOpenDesignStatus: call(desktopIpc.getOpenDesignStatus),
    installOpenDesign: call(desktopIpc.installOpenDesign),
    setComposerWorkMode: call(desktopIpc.setComposerWorkMode),
    getComposerWorkMode: call(desktopIpc.getComposerWorkMode),

    ensureTerminalPanel: call(desktopIpc.terminalEnsurePanel),
    createTerminalSession: call(desktopIpc.terminalCreateSession),
    setActiveTerminalSession: call(desktopIpc.terminalSetActiveSession),
    writeTerminal: call(desktopIpc.terminalWrite),
    resizeTerminal: call(desktopIpc.terminalResize),
    restartTerminalSession: call(desktopIpc.terminalRestartSession),
    closeTerminalSession: call(desktopIpc.terminalCloseSession),
    setTerminalTitle: call(desktopIpc.terminalSetTitle),
    setTerminalFocused: (focused: boolean): Promise<void> =>
      invoke("pi_invoke", { method: desktopIpc.terminalSetFocused, args: [focused] }).then(() => undefined),
    onTerminalData: (listener: Listener) => subscribe("terminalData", listener),
    onTerminalExit: (listener: Listener) => subscribe("terminalExit", listener),
    onTerminalError: (listener: Listener) => subscribe("terminalError", listener),

    getNotificationPermissionStatus: call(desktopIpc.getNotificationPermissionStatus),
    requestNotificationPermission: call(desktopIpc.requestNotificationPermission),
    openSystemNotificationSettings: call(desktopIpc.openSystemNotificationSettings),
    onNotificationPermissionStatusChanged: (listener: Listener) =>
      subscribe("notificationPermissionStatusChanged", listener),

    pickComposerAttachments: call(desktopIpc.pickComposerAttachments),
    // Synchronous in the Electron contract; clipboard-image paste isn't wired
    // for Tauri yet, so return null and rely on file attachments.
    readClipboardImage: (): null => null,
    addComposerAttachments: call(desktopIpc.addComposerAttachments),
    removeComposerAttachment: call(desktopIpc.removeComposerAttachment),
    editQueuedComposerMessage: call(desktopIpc.editQueuedComposerMessage),
    cancelQueuedComposerEdit: call(desktopIpc.cancelQueuedComposerEdit),
    removeQueuedComposerMessage: call(desktopIpc.removeQueuedComposerMessage),
    steerQueuedComposerMessage: call(desktopIpc.steerQueuedComposerMessage),
    updateComposerDraft: call(desktopIpc.updateComposerDraft),
    submitComposer: call(desktopIpc.submitComposer),

    getSessionTree: call(desktopIpc.getSessionTree),
    navigateSessionTree: call(desktopIpc.navigateSessionTree),
    listWorkspaceFiles: call(desktopIpc.listWorkspaceFiles),
    getChangedFiles: call(desktopIpc.getChangedFiles),
    getFileDiff: call(desktopIpc.getFileDiff),
    stageFile: call(desktopIpc.stageFile),
    toggleWindowMaximize: call(desktopIpc.toggleWindowMaximize),
    openExternal: call(desktopIpc.openExternal),

    getThemeMode: call(desktopIpc.getThemeMode),
    getResolvedTheme: call(desktopIpc.getResolvedTheme),
    setThemeMode: call(desktopIpc.setThemeMode),
    onThemeChanged: (listener: Listener) => subscribe("themeChanged", listener),
  };

  (window as unknown as { piApp: unknown }).piApp = piApp;
}

function navigatorPlatform(): string {
  if (typeof navigator !== "undefined") {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("mac")) return "darwin";
    if (ua.includes("win")) return "win32";
    if (ua.includes("linux")) return "linux";
  }
  return "darwin";
}
