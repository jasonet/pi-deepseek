import type {
  ProbeRuntimeCustomModelProviderInput,
  ProbeRuntimeCustomModelProviderResult,
  RuntimeAppendSystemPrompt,
  RuntimeCustomModelProviderRecord,
  RuntimePackageRecord,
  RuntimePackageUpdate,
  SaveRuntimeCustomModelProviderInput,
  RuntimeSettingsSnapshot,
} from "@pi-gui/session-driver/runtime-types";
import type {
  NavigateSessionTreeOptions,
  NavigateSessionTreeResult,
  SessionTreeSnapshot,
} from "@pi-gui/session-driver/types";
import type {
  AppView,
  ComposerAttachment,
  ComposerImageAttachment,
  CreateSessionInput,
  ConnectPhoneQrPollResult,
  ConnectPhoneQrStartInput,
  ConnectPhoneQrStartResult,
  CreateWorktreeInput,
  DesktopAppState,
  ModelSettingsScopeMode,
  NotificationPreferences,
  RemoveWorktreeInput,
  SaveImChannelInput,
  SelectedTranscriptRecord,
  StartThreadInput,
  WorkspaceSessionTarget,
} from "./desktop-state";
import type { FxAuthProvider, FxAuthStatus } from "./fx-auth";

export type DesktopNotificationPermissionStatus =
  | "granted"
  | "denied"
  | "default"
  | "unsupported"
  | "unknown";

export type DesktopUpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "up-to-date"
  | "error"
  | "unsupported";

export type FilePreviewKind = "markdown" | "code" | "text" | "image" | "pdf" | "unsupported";

export interface FilePreviewResult {
  readonly ok: boolean;
  readonly kind: FilePreviewKind;
  readonly path: string;
  readonly name: string;
  readonly sizeBytes: number;
  readonly content?: string;
  readonly dataUrl?: string;
  readonly language?: string;
  readonly message?: string;
}

export interface DesktopUpdateStatus {
  readonly phase: DesktopUpdatePhase;
  readonly currentVersion: string;
  readonly latestVersion?: string;
  readonly percent?: number;
  readonly transferred?: number;
  readonly total?: number;
  readonly bytesPerSecond?: number;
  readonly message?: string;
}

export const desktopIpc = {
  stateRequest: "pi-gui:state-request",
  stateChanged: "pi-gui:state-changed",
  selectedTranscriptRequest: "pi-gui:selected-transcript-request",
  selectedTranscriptChanged: "pi-gui:selected-transcript-changed",
  transcriptForRequest: "pi-gui:transcript-for-request",
  submitComposerFor: "pi-gui:submit-composer-for",
  appCommand: "pi-gui:app-command",
  workspacePicked: "pi-gui:workspace-picked",
  clipboardImagePasted: "pi-gui:clipboard-image-pasted",
  addWorkspacePath: "pi-gui:add-workspace-path",
  pickWorkspace: "pi-gui:pick-workspace",
  selectWorkspace: "pi-gui:select-workspace",
  renameWorkspace: "pi-gui:rename-workspace",
  removeWorkspace: "pi-gui:remove-workspace",
  reorderWorkspaces: "pi-gui:reorder-workspaces",
  openWorkspaceInFinder: "pi-gui:open-workspace-in-finder",
  createWorktree: "pi-gui:create-worktree",
  removeWorktree: "pi-gui:remove-worktree",
  openSkillInFinder: "pi-gui:open-skill-in-finder",
  openExtensionInFinder: "pi-gui:open-extension-in-finder",
  syncCurrentWorkspace: "pi-gui:sync-current-workspace",
  selectSession: "pi-gui:select-session",
  archiveSession: "pi-gui:archive-session",
  unarchiveSession: "pi-gui:unarchive-session",
  createSession: "pi-gui:create-session",
  startThread: "pi-gui:start-thread",
  cancelCurrentRun: "pi-gui:cancel-current-run",
  cancelCurrentRunFor: "pi-gui:cancel-current-run-for",
  setActiveView: "pi-gui:set-active-view",
  setSidebarCollapsed: "pi-gui:set-sidebar-collapsed",
  setWorkspaceCollapsed: "pi-gui:set-workspace-collapsed",
  setArchivedSectionExpanded: "pi-gui:set-archived-section-expanded",
  refreshRuntime: "pi-gui:refresh-runtime",
  setModelSettingsScopeMode: "pi-gui:set-model-settings-scope-mode",
  setDefaultModel: "pi-gui:set-default-model",
  setDefaultThinkingLevel: "pi-gui:set-default-thinking-level",
  setSessionModel: "pi-gui:set-session-model",
  setSessionThinkingLevel: "pi-gui:set-session-thinking-level",
  loginProvider: "pi-gui:login-provider",
  getFxAuthStatus: "pi-gui:get-fx-auth-status",
  loginFxProvider: "pi-gui:login-fx-provider",
  selectFxProvider: "pi-gui:select-fx-provider",
  logoutProvider: "pi-gui:logout-provider",
  setProviderApiKey: "pi-gui:set-provider-api-key",
  listCustomModelProviders: "pi-gui:list-custom-model-providers",
  probeCustomModelProvider: "pi-gui:probe-custom-model-provider",
  saveCustomModelProvider: "pi-gui:save-custom-model-provider",
  removeCustomModelProvider: "pi-gui:remove-custom-model-provider",
  setEnableSkillCommands: "pi-gui:set-enable-skill-commands",
  setScopedModelPatterns: "pi-gui:set-scoped-model-patterns",
  setSkillEnabled: "pi-gui:set-skill-enabled",
  setExtensionEnabled: "pi-gui:set-extension-enabled",
  listPackages: "pi-gui:list-packages",
  checkForPackageUpdates: "pi-gui:check-for-package-updates",
  installPackage: "pi-gui:install-package",
  removePackage: "pi-gui:remove-package",
  updatePackages: "pi-gui:update-packages",
  getAppendSystemPrompt: "pi-gui:get-append-system-prompt",
  setAppendSystemPrompt: "pi-gui:set-append-system-prompt",
  respondToHostUiRequest: "pi-gui:respond-to-host-ui-request",
  setNotificationPreferences: "pi-gui:set-notification-preferences",
  saveImChannel: "pi-gui:save-im-channel",
  removeImChannel: "pi-gui:remove-im-channel",
  updateImChannelSession: "pi-gui:update-im-channel-session",
  startConnectPhoneQr: "pi-gui:start-connect-phone-qr",
  pollConnectPhoneQr: "pi-gui:poll-connect-phone-qr",
  setIntegratedTerminalShell: "pi-gui:set-integrated-terminal-shell",
  setEnableTransparency: "pi-gui:set-enable-transparency",
  setLocale: "pi-gui:set-locale",
  getLocale: "pi-gui:get-locale",
  getProviderBalance: "pi-gui:get-provider-balance",
  checkForUpdate: "pi-gui:check-for-update",
  downloadUpdate: "pi-gui:download-update",
  installUpdate: "pi-gui:install-update",
  getUpdateStatus: "pi-gui:get-update-status",
  updateStatusChanged: "pi-gui:update-status-changed",
  setAutoUpdateEnabled: "pi-gui:set-auto-update-enabled",
  getAutoUpdateEnabled: "pi-gui:get-auto-update-enabled",
  setSkipAutoTitle: "pi-gui:set-skip-auto-title",
  getOpenDesignStatus: "pi-gui:get-open-design-status",
  installOpenDesign: "pi-gui:install-open-design",
  getDshWebStatus: "pi-gui:get-dsh-web-status",
  startDshWeb: "pi-gui:start-dsh-web",
  stopDshWeb: "pi-gui:stop-dsh-web",
  getTregStatus: "pi-gui:get-treg-status",
  saveTregSettings: "pi-gui:save-treg-settings",
  installTregHarnessPlugin: "pi-gui:install-treg-harness-plugin",
  setComposerWorkMode: "pi-gui:set-composer-work-mode",
  getComposerWorkMode: "pi-gui:get-composer-work-mode",
  terminalEnsurePanel: "pi-gui:terminal-ensure-panel",
  terminalCreateSession: "pi-gui:terminal-create-session",
  terminalSetActiveSession: "pi-gui:terminal-set-active-session",
  terminalWrite: "pi-gui:terminal-write",
  terminalResize: "pi-gui:terminal-resize",
  terminalRestartSession: "pi-gui:terminal-restart-session",
  terminalCloseSession: "pi-gui:terminal-close-session",
  terminalSetTitle: "pi-gui:terminal-set-title",
  terminalSetFocused: "pi-gui:terminal-set-focused",
  terminalData: "pi-gui:terminal-data",
  terminalExit: "pi-gui:terminal-exit",
  terminalError: "pi-gui:terminal-error",
  getNotificationPermissionStatus: "pi-gui:get-notification-permission-status",
  requestNotificationPermission: "pi-gui:request-notification-permission",
  openSystemNotificationSettings: "pi-gui:open-system-notification-settings",
  notificationPermissionStatusChanged: "pi-gui:notification-permission-status-changed",
  pickComposerAttachments: "pi-gui:pick-composer-attachments",
  readClipboardImage: "pi-gui:read-clipboard-image",
  addComposerAttachments: "pi-gui:add-composer-attachments",
  removeComposerAttachment: "pi-gui:remove-composer-attachment",
  editQueuedComposerMessage: "pi-gui:edit-queued-composer-message",
  cancelQueuedComposerEdit: "pi-gui:cancel-queued-composer-edit",
  removeQueuedComposerMessage: "pi-gui:remove-queued-composer-message",
  steerQueuedComposerMessage: "pi-gui:steer-queued-composer-message",
  updateComposerDraft: "pi-gui:update-composer-draft",
  submitComposer: "pi-gui:submit-composer",
  getSessionTree: "pi-gui:get-session-tree",
  navigateSessionTree: "pi-gui:navigate-session-tree",
  toggleWindowMaximize: "pi-gui:toggle-window-maximize",
  listWorkspaceFiles: "pi-gui:list-workspace-files",
  previewWorkspaceFile: "pi-gui:preview-workspace-file",
  saveWorkspaceFileAs: "pi-gui:save-workspace-file-as",
  getChangedFiles: "pi-gui:get-changed-files",
  getFileDiff: "pi-gui:get-file-diff",
  stageFile: "pi-gui:stage-file",
  getThemeMode: "pi-gui:get-theme-mode",
  getResolvedTheme: "pi-gui:get-resolved-theme",
  setThemeMode: "pi-gui:set-theme-mode",
  themeChanged: "pi-gui:theme-changed",
  ping: "app:ping",
  openExternal: "app:open-external",
} as const;

export const desktopCommands = {
  openSettings: "open-settings",
  openNewThread: "open-new-thread",
  openConnectPhone: "open-connect-phone",
  closeActiveSession: "close-active-session",
  toggleTerminal: "toggle-terminal",
  toggleSidebar: "toggle-sidebar",
  toggleDualPane: "toggle-dual-pane",
} as const;

export function getDesktopShortcutLabel(platform: NodeJS.Platform, key: string): string {
  return `${platform === "darwin" ? "⌘" : "Ctrl+"}${key.toUpperCase()}`;
}

export type PiDesktopStateListener = (state: DesktopAppState) => void;
export type PiDesktopSelectedTranscriptListener = (payload: SelectedTranscriptRecord | null) => void;
export type PiDesktopCommand = (typeof desktopCommands)[keyof typeof desktopCommands];

export interface TerminalSize {
  readonly cols: number;
  readonly rows: number;
}

export type TerminalSessionStatus = "running" | "exited" | "error";

export interface TerminalSessionSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly cwd: string;
  readonly shell: string;
  readonly title: string;
  readonly status: TerminalSessionStatus;
  readonly replay: string;
  readonly truncated: boolean;
  readonly exitCode?: number;
  readonly signal?: number;
}

export interface TerminalPanelSnapshot {
  readonly workspaceId: string;
  readonly rootKey: string;
  readonly activeSessionId: string;
  readonly sessions: readonly TerminalSessionSnapshot[];
}

export interface TerminalDataEvent {
  readonly terminalId: string;
  readonly data: string;
}

export interface TerminalExitEvent {
  readonly terminalId: string;
  readonly exitCode?: number;
  readonly signal?: number;
}

export interface TerminalErrorEvent {
  readonly terminalId: string;
  readonly message: string;
}

export interface OpenDesignStatus {
  readonly daemonUrl: string;
  readonly webUrl: string;
  readonly reachable: boolean;
  readonly daemonReachable?: boolean;
  readonly webReachable?: boolean;
  readonly version?: string;
  readonly message?: string;
}

export type DshWebStatus =
  | {
      readonly state: "idle" | "starting";
    }
  | {
      readonly state: "running";
      readonly url: string;
    }
  | {
      readonly state: "error";
      readonly message: string;
    };

export interface TregSettings {
  readonly enabled: boolean;
  readonly piEnabled: boolean;
  readonly harnessEnabled: boolean;
  readonly serviceUrl: string;
  readonly paidCalls: "disabled" | "ask";
  readonly allowMutatingCalls: boolean;
  readonly workspaceRoots: readonly string[];
}

export type SaveTregSettingsInput = TregSettings;

export interface TregStatus {
  readonly settings: TregSettings;
  readonly tokenConfigured: boolean;
  readonly tokenSource?: "env" | "config";
  readonly connected: boolean;
  readonly balanceUsd?: number;
  readonly harnessInstalled: boolean;
  readonly message?: string;
}

export interface DesktopShortcutInput {
  readonly modifier: boolean;
  readonly shift: boolean;
  readonly key: string;
  readonly code?: string;
}

export interface ArchiveSessionOptions {
  readonly includePaired?: boolean;
}

export function getDesktopCommandFromShortcut(input: DesktopShortcutInput): PiDesktopCommand | undefined {
  if (!input.modifier) {
    return undefined;
  }

  const lowerKey = input.key.toLowerCase();
  const isComma = input.key === "," || input.code === "Comma";
  const isB = lowerKey === "b" || input.code === "KeyB";
  const isJ = lowerKey === "j" || input.code === "KeyJ";
  const isN = lowerKey === "n" || input.code === "KeyN";
  const isM = lowerKey === "m" || input.code === "KeyM";
  const isD = lowerKey === "d" || input.code === "KeyD";
  const isW = lowerKey === "w" || input.code === "KeyW";
  const isShiftO = input.shift && (lowerKey === "o" || input.code === "KeyO");

  if (!input.shift && isComma) {
    return desktopCommands.openSettings;
  }

  if (!input.shift && isJ) {
    return desktopCommands.toggleTerminal;
  }

  if (!input.shift && isB) {
    return desktopCommands.toggleSidebar;
  }

  // Cmd/Ctrl+N starts a new session. Cmd/Ctrl+Shift+O is kept as a legacy alias.
  if ((!input.shift && isN) || isShiftO) {
    return desktopCommands.openNewThread;
  }

  // Cmd/Ctrl+M opens the Connect Phone view.
  if (!input.shift && isM) {
    return desktopCommands.openConnectPhone;
  }

  // Cmd/Ctrl+W closes the active conversation instead of the app window.
  if (!input.shift && isW) {
    return desktopCommands.closeActiveSession;
  }

  // Cmd/Ctrl+D toggles the dual-pane (split) view. Routed through the main
  // before-input-event path like every other app shortcut so the physical key
  // is captured natively; a renderer-only window keydown listener was missing
  // these presses. (Cmd+Shift+D is reserved for the diff panel.)
  if (!input.shift && isD) {
    return desktopCommands.toggleDualPane;
  }

  return undefined;
}

export interface PiDesktopApi {
  platform: NodeJS.Platform;
  versions: NodeJS.ProcessVersions;
  ping(): Promise<string>;
  getState(): Promise<DesktopAppState>;
  onStateChanged(listener: PiDesktopStateListener): () => void;
  getSelectedTranscript(): Promise<SelectedTranscriptRecord | null>;
  getTranscriptFor(target: WorkspaceSessionTarget): Promise<SelectedTranscriptRecord | null>;
  onSelectedTranscriptChanged(listener: PiDesktopSelectedTranscriptListener): () => void;
  onCommand(listener: (command: PiDesktopCommand) => void): () => void;
  onWorkspacePicked(listener: (workspaceId: string) => void): () => void;
  onClipboardImagePasted(listener: (attachment: ComposerImageAttachment) => void): () => void;
  getPathForFile(file: File): string;
  addWorkspacePath(path: string): Promise<DesktopAppState>;
  pickWorkspace(): Promise<DesktopAppState>;
  selectWorkspace(workspaceId: string): Promise<DesktopAppState>;
  renameWorkspace(workspaceId: string, displayName: string): Promise<DesktopAppState>;
  removeWorkspace(workspaceId: string): Promise<DesktopAppState>;
  reorderWorkspaces(workspaceOrder: readonly string[]): Promise<DesktopAppState>;
  openWorkspaceInFinder(workspaceId: string): Promise<void>;
  createWorktree(input: CreateWorktreeInput): Promise<DesktopAppState>;
  removeWorktree(input: RemoveWorktreeInput): Promise<DesktopAppState>;
  openSkillInFinder(workspaceId: string, filePath: string): Promise<void>;
  openExtensionInFinder(workspaceId: string, filePath: string): Promise<void>;
  syncCurrentWorkspace(): Promise<DesktopAppState>;
  selectSession(target: WorkspaceSessionTarget): Promise<DesktopAppState>;
  archiveSession(target: WorkspaceSessionTarget, options?: ArchiveSessionOptions): Promise<DesktopAppState>;
  unarchiveSession(target: WorkspaceSessionTarget): Promise<DesktopAppState>;
  createSession(input: CreateSessionInput): Promise<DesktopAppState>;
  startThread(input: StartThreadInput): Promise<DesktopAppState>;
  cancelCurrentRun(): Promise<DesktopAppState>;
  cancelCurrentRunFor(target: WorkspaceSessionTarget): Promise<DesktopAppState>;
  setActiveView(view: AppView): Promise<DesktopAppState>;
  setSidebarCollapsed(collapsed: boolean): Promise<DesktopAppState>;
  setWorkspaceCollapsed(workspaceId: string, collapsed: boolean): Promise<DesktopAppState>;
  setArchivedSectionExpanded(workspaceId: string, expanded: boolean): Promise<DesktopAppState>;
  refreshRuntime(workspaceId?: string): Promise<DesktopAppState>;
  setModelSettingsScopeMode(mode: ModelSettingsScopeMode): Promise<DesktopAppState>;
  setDefaultModel(workspaceId: string, provider: string, modelId: string): Promise<DesktopAppState>;
  setDefaultThinkingLevel(
    workspaceId: string,
    thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"],
  ): Promise<DesktopAppState>;
  setSessionModel(
    workspaceId: string,
    sessionId: string,
    provider: string,
    modelId: string,
  ): Promise<DesktopAppState>;
  setSessionThinkingLevel(
    workspaceId: string,
    sessionId: string,
    thinkingLevel: NonNullable<RuntimeSettingsSnapshot["defaultThinkingLevel"]>,
  ): Promise<DesktopAppState>;
  loginProvider(workspaceId: string, providerId: string): Promise<DesktopAppState>;
  getFxAuthStatus(workspaceId: string): Promise<FxAuthStatus>;
  loginFxProvider(workspaceId: string, provider: FxAuthProvider): Promise<FxAuthStatus>;
  selectFxProvider(workspaceId: string, provider: FxAuthProvider): Promise<FxAuthStatus>;
  logoutProvider(workspaceId: string, providerId: string): Promise<DesktopAppState>;
  setProviderApiKey(workspaceId: string, providerId: string, apiKey: string): Promise<DesktopAppState>;
  listCustomModelProviders(): Promise<readonly RuntimeCustomModelProviderRecord[]>;
  probeCustomModelProvider(
    input: ProbeRuntimeCustomModelProviderInput,
  ): Promise<ProbeRuntimeCustomModelProviderResult>;
  saveCustomModelProvider(
    workspaceId: string,
    input: SaveRuntimeCustomModelProviderInput,
  ): Promise<DesktopAppState>;
  removeCustomModelProvider(workspaceId: string, providerId: string): Promise<DesktopAppState>;
  setEnableSkillCommands(workspaceId: string, enabled: boolean): Promise<DesktopAppState>;
  setScopedModelPatterns(workspaceId: string, patterns: readonly string[]): Promise<DesktopAppState>;
  setSkillEnabled(workspaceId: string, filePath: string, enabled: boolean): Promise<DesktopAppState>;
  setExtensionEnabled(workspaceId: string, filePath: string, enabled: boolean): Promise<DesktopAppState>;
  listPackages(workspaceId?: string): Promise<readonly RuntimePackageRecord[]>;
  checkForPackageUpdates(workspaceId?: string): Promise<readonly RuntimePackageUpdate[]>;
  installPackage(workspaceId: string, source: string): Promise<DesktopAppState>;
  removePackage(workspaceId: string, source: string): Promise<DesktopAppState>;
  updatePackages(workspaceId: string, source?: string): Promise<DesktopAppState>;
  getAppendSystemPrompt(workspaceId?: string): Promise<RuntimeAppendSystemPrompt | null>;
  setAppendSystemPrompt(
    workspaceId: string,
    scope: "project" | "global",
    content: string,
  ): Promise<RuntimeAppendSystemPrompt | null>;
  respondToHostUiRequest(
    workspaceId: string,
    sessionId: string,
    response:
      | { readonly requestId: string; readonly value: string }
      | { readonly requestId: string; readonly confirmed: boolean }
      | { readonly requestId: string; readonly cancelled: true },
  ): Promise<DesktopAppState>;
  setNotificationPreferences(preferences: Partial<NotificationPreferences>): Promise<DesktopAppState>;
  saveImChannel(input: SaveImChannelInput): Promise<DesktopAppState>;
  removeImChannel(channelId: string): Promise<DesktopAppState>;
  updateImChannelSession(provider: ConnectPhoneQrStartInput["provider"], sessionId: string): Promise<DesktopAppState>;
  startConnectPhoneQr(input: ConnectPhoneQrStartInput): Promise<ConnectPhoneQrStartResult>;
  pollConnectPhoneQr(provider: ConnectPhoneQrStartInput["provider"], deviceCode: string): Promise<ConnectPhoneQrPollResult>;
  setIntegratedTerminalShell(shell: string): Promise<DesktopAppState>;
  setEnableTransparency(enabled: boolean): Promise<DesktopAppState>;
  setLocale(locale: string): Promise<DesktopAppState>;
  getLocale(): Promise<string>;
  getProviderBalance(providerId: string): Promise<{ balance: string } | { error: string }>;
  checkForUpdate(): Promise<DesktopUpdateStatus>;
  downloadUpdate(): Promise<DesktopUpdateStatus>;
  installUpdate(): Promise<void>;
  getUpdateStatus(): Promise<DesktopUpdateStatus>;
  onUpdateStatusChanged(callback: (status: DesktopUpdateStatus) => void): () => void;
  setAutoUpdateEnabled(enabled: boolean): Promise<boolean>;
  getAutoUpdateEnabled(): Promise<boolean>;
  setSkipAutoTitle(enabled: boolean): Promise<DesktopAppState>;
  getOpenDesignStatus(): Promise<OpenDesignStatus>;
  installOpenDesign(): Promise<{ ok: boolean; message: string }>;
  getDshWebStatus(): Promise<DshWebStatus>;
  startDshWeb(): Promise<DshWebStatus>;
  stopDshWeb(): Promise<DshWebStatus>;
  getTregStatus(): Promise<TregStatus>;
  saveTregSettings(settings: SaveTregSettingsInput): Promise<TregStatus>;
  installTregHarnessPlugin(): Promise<{ ok: boolean; message: string }>;
  setComposerWorkMode(mode: string): Promise<DesktopAppState>;
  getComposerWorkMode(): Promise<string>;
  ensureTerminalPanel(
    workspaceId: string,
    terminalScopeId: string,
    size?: Partial<TerminalSize>,
  ): Promise<TerminalPanelSnapshot>;
  createTerminalSession(
    workspaceId: string,
    terminalScopeId: string,
    size?: Partial<TerminalSize>,
  ): Promise<TerminalPanelSnapshot>;
  setActiveTerminalSession(
    workspaceId: string,
    terminalScopeId: string,
    terminalId: string,
  ): Promise<TerminalPanelSnapshot>;
  writeTerminal(terminalId: string, data: string): Promise<void>;
  resizeTerminal(terminalId: string, size: TerminalSize): Promise<void>;
  restartTerminalSession(terminalId: string, size?: Partial<TerminalSize>): Promise<TerminalPanelSnapshot>;
  closeTerminalSession(terminalId: string): Promise<TerminalPanelSnapshot | null>;
  setTerminalTitle(terminalId: string, title: string): Promise<void>;
  setTerminalFocused(focused: boolean): Promise<void>;
  onTerminalData(listener: (event: TerminalDataEvent) => void): () => void;
  onTerminalExit(listener: (event: TerminalExitEvent) => void): () => void;
  onTerminalError(listener: (event: TerminalErrorEvent) => void): () => void;
  getNotificationPermissionStatus(): Promise<DesktopNotificationPermissionStatus>;
  requestNotificationPermission(): Promise<DesktopNotificationPermissionStatus>;
  openSystemNotificationSettings(): Promise<void>;
  onNotificationPermissionStatusChanged(
    callback: (status: DesktopNotificationPermissionStatus) => void,
  ): () => void;
  pickComposerAttachments(): Promise<DesktopAppState>;
  readClipboardImage(): ComposerImageAttachment | null;
  addComposerAttachments(attachments: readonly ComposerAttachment[]): Promise<DesktopAppState>;
  removeComposerAttachment(attachmentId: string): Promise<DesktopAppState>;
  editQueuedComposerMessage(messageId: string, currentDraft?: string): Promise<DesktopAppState>;
  cancelQueuedComposerEdit(): Promise<DesktopAppState>;
  removeQueuedComposerMessage(messageId: string): Promise<DesktopAppState>;
  steerQueuedComposerMessage(messageId: string): Promise<DesktopAppState>;
  updateComposerDraft(composerDraft: string): Promise<DesktopAppState>;
  submitComposer(text: string, options?: { readonly deliverAs?: "steer" | "followUp" }): Promise<DesktopAppState>;
  submitComposerFor(
    target: WorkspaceSessionTarget,
    text: string,
    options?: { readonly deliverAs?: "steer" | "followUp" },
  ): Promise<DesktopAppState>;
  getSessionTree(target: WorkspaceSessionTarget): Promise<SessionTreeSnapshot>;
  navigateSessionTree(
    target: WorkspaceSessionTarget,
    targetId: string,
    options?: NavigateSessionTreeOptions,
  ): Promise<{ readonly state: DesktopAppState; readonly result: NavigateSessionTreeResult }>;
  listWorkspaceFiles(workspaceId: string): Promise<string[]>;
  previewWorkspaceFile(workspaceId: string, filePath: string): Promise<FilePreviewResult>;
  saveWorkspaceFileAs(workspaceId: string, filePath: string): Promise<boolean>;
  getChangedFiles(workspaceId: string): Promise<{ path: string; status: "added" | "modified" | "deleted" | "untracked"; staged: boolean }[]>;
  getFileDiff(workspaceId: string, filePath: string): Promise<string>;
  stageFile(workspaceId: string, filePath: string): Promise<void>;
  toggleWindowMaximize(): Promise<void>;
  openExternal(url: string): Promise<void>;
  getThemeMode(): Promise<"system" | "light" | "dark">;
  getResolvedTheme(): Promise<"light" | "dark">;
  setThemeMode(mode: "system" | "light" | "dark"): Promise<string>;
  onThemeChanged(callback: (theme: "light" | "dark") => void): () => void;
}
