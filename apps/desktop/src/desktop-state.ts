import type { HostUiRequest, SessionConfig } from "@pi-gui/session-driver";
import type { ModelSettingsSnapshot, RuntimeCommandRecord, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
export type SessionStatus = "idle" | "running" | "failed";
export type { SessionRole, TranscriptMessage } from "./timeline-types";
import type { TranscriptMessage } from "./timeline-types";

export type AppView = "threads" | "new-thread" | "skills" | "extensions" | "settings" | "connect-phone";
export type WorkspaceKind = "primary" | "worktree";
export type WorktreeStatus = "ready" | "missing" | "error";
export type NewThreadEnvironment = "local" | "worktree";
export type ThemeMode = "system" | "light" | "dark";
export type ModelSettingsScopeMode = "app-global" | "per-repo";
export type Locale = "en" | "zh-CN" | "zh-TW" | "ja";
export type ComposerWorkMode = "pi-agent" | "open-design";
export type ImProvider =
  | "feishu"
  | "weixin"
  | "telegram"
  | "discord"
  | "dingtalk"
  | "slack"
  | "whatsapp"
  | "line";
export type ConnectPhoneProvider = Extract<ImProvider, "feishu" | "weixin">;
export type ImProviderStatus = "stopped" | "starting" | "running" | "error";
export type ComposerDraftSyncSource =
  | "state"
  | "selection"
  | "persist"
  | "command"
  | "extension-editor-text"
  | "queued-message-edit";

export interface NotificationPreferences {
  readonly backgroundCompletion: boolean;
  readonly backgroundFailure: boolean;
  readonly attentionNeeded: boolean;
}

export interface ImAgentProfile {
  readonly name: string;
  readonly description: string;
  readonly identity: string;
  readonly personality: string;
  readonly userContext: string;
  readonly replyRules: string;
}

export type ImCredential =
  | { readonly kind: "feishu"; readonly appId: string; readonly appSecret: string; readonly domain: "feishu" | "lark" }
  | { readonly kind: "weixin"; readonly accountId: string; readonly sessionKey: string }
  | { readonly kind: "telegram"; readonly botToken: string }
  | { readonly kind: "discord"; readonly botToken: string }
  | { readonly kind: "dingtalk"; readonly appKey: string; readonly appSecret: string }
  | { readonly kind: "slack"; readonly botToken: string; readonly signingSecret: string }
  | { readonly kind: "whatsapp"; readonly phoneNumberId: string; readonly accessToken: string }
  | { readonly kind: "line"; readonly channelAccessToken: string; readonly channelSecret: string };

export interface ImSettings {
  readonly enabled: boolean;
  readonly provider: ImProvider;
  readonly port: number;
  readonly path: string;
  readonly secret: string;
  readonly workspaceRoot: string;
  readonly model: string;
  readonly mode: "agent" | "plan";
  readonly responseTimeoutMs: number;
}

export interface ImChannel {
  readonly id: string;
  readonly provider: ImProvider;
  readonly label: string;
  readonly enabled: boolean;
  readonly status: ImProviderStatus;
  readonly credential: ImCredential;
  readonly agentProfile: ImAgentProfile;
  readonly settings: ImSettings;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type SaveImChannelInput = Omit<ImChannel, "id" | "status" | "createdAt" | "updatedAt"> & {
  readonly id?: string;
  readonly status?: ImProviderStatus;
};

export interface ConnectPhoneQrStartInput {
  readonly provider: ConnectPhoneProvider;
  readonly isLark?: boolean;
}

export type ConnectPhoneQrStartResult =
  | {
      readonly ok: true;
      readonly url: string;
      readonly deviceCode: string;
      readonly userCode: string;
      readonly interval: number;
      readonly expireIn: number;
    }
  | { readonly ok: false; readonly message: string };

export type ConnectPhoneQrPollResult =
  | { readonly done: false; readonly message?: string }
  | { readonly done: true; readonly provider: ConnectPhoneProvider; readonly credential: Extract<ImCredential, { readonly kind: ConnectPhoneProvider }> };

export interface ComposerImageAttachment {
  readonly id: string;
  readonly kind: "image";
  readonly name: string;
  readonly mimeType: string;
  readonly data: string;
}

export interface ComposerFileAttachment {
  readonly id: string;
  readonly kind: "file";
  readonly name: string;
  readonly mimeType: string;
  readonly fsPath: string;
  readonly sizeBytes?: number;
}

export type ComposerAttachment = ComposerImageAttachment | ComposerFileAttachment;

export type QueuedComposerMessageMode = "steer" | "followUp";

export interface QueuedComposerMessage {
  readonly id: string;
  readonly mode: QueuedComposerMessageMode;
  readonly text: string;
  readonly attachments: readonly ComposerAttachment[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SessionRecord {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly lastViewedAt?: string;
  readonly archivedAt?: string;
  readonly preview: string;
  readonly status: SessionStatus;
  readonly runningSince?: string;
  readonly hasUnseenUpdate: boolean;
  readonly config?: SessionConfig;
}

export interface SelectedTranscriptRecord {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly transcript: readonly TranscriptMessage[];
}

export interface WorktreeRecord {
  readonly id: string;
  readonly rootWorkspaceId: string;
  readonly linkedWorkspaceId?: string;
  readonly name: string;
  readonly path: string;
  readonly status: WorktreeStatus;
  readonly branchName?: string;
  readonly updatedAt: string;
}

export interface SessionExtensionStatusRecord {
  readonly key: string;
  readonly text: string;
}

export interface SessionExtensionWidgetRecord {
  readonly key: string;
  readonly lines: readonly string[];
  readonly placement: "aboveComposer" | "belowComposer";
}

export type SessionExtensionDialogRecord = Extract<
  HostUiRequest,
  { readonly kind: "confirm" | "select" | "input" | "editor" }
>;

export interface SessionExtensionUiStateRecord {
  readonly statuses: readonly SessionExtensionStatusRecord[];
  readonly widgets: readonly SessionExtensionWidgetRecord[];
  readonly pendingDialogs: readonly SessionExtensionDialogRecord[];
  readonly title?: string;
  readonly editorText?: string;
}

export type ExtensionCommandCompatibilityStatus = "supported" | "terminal-only";

export interface ExtensionCommandCompatibilityRecord {
  readonly commandName: string;
  readonly extensionPath: string;
  readonly status: ExtensionCommandCompatibilityStatus;
  readonly message: string;
  readonly capability: string;
  readonly updatedAt: string;
}

export interface WorkspaceRecord {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly lastOpenedAt: string;
  readonly kind: WorkspaceKind;
  readonly rootWorkspaceId?: string;
  readonly branchName?: string;
  readonly sessions: readonly SessionRecord[];
}

export interface CreateWorktreeInput {
  readonly workspaceId: string;
  readonly fromSessionWorkspaceId?: string;
  readonly fromSessionId?: string;
}

export type StartThreadInput = {
  readonly rootWorkspaceId: string;
  readonly environment: NewThreadEnvironment;
  readonly prompt?: string;
  readonly attachments?: readonly ComposerAttachment[];
  readonly provider?: string;
  readonly modelId?: string;
  readonly thinkingLevel?: string;
};

export interface RemoveWorktreeInput {
  readonly workspaceId: string;
  readonly worktreeId: string;
}

export interface DesktopAppState {
  readonly workspaces: readonly WorkspaceRecord[];
  readonly worktreesByWorkspace: Readonly<Record<string, readonly WorktreeRecord[]>>;
  readonly selectedWorkspaceId: string;
  readonly selectedSessionId: string;
  readonly activeView: AppView;
  readonly composerDraft: string;
  readonly composerDraftSyncSource: ComposerDraftSyncSource;
  readonly composerDraftSyncNonce: number;
  readonly composerAttachments: readonly ComposerAttachment[];
  readonly queuedComposerMessages: readonly QueuedComposerMessage[];
  readonly editingQueuedMessageId?: string;
  readonly runtimeByWorkspace: Readonly<Record<string, RuntimeSnapshot>>;
  readonly sessionCommandsBySession: Readonly<Record<string, readonly RuntimeCommandRecord[]>>;
  readonly sessionExtensionUiBySession: Readonly<Record<string, SessionExtensionUiStateRecord>>;
  readonly extensionCommandCompatibilityByWorkspace: Readonly<Record<string, readonly ExtensionCommandCompatibilityRecord[]>>;
  readonly notificationPreferences: NotificationPreferences;
  readonly imChannels: readonly ImChannel[];
  readonly integratedTerminalShell: string;
  readonly lastViewedAtBySession: Readonly<Record<string, string>>;
  readonly workspaceOrder: readonly string[];
  readonly modelSettingsScopeMode: ModelSettingsScopeMode;
  readonly globalModelSettings: ModelSettingsSnapshot;
  readonly sidebarCollapsed: boolean;
  readonly enableTransparency: boolean;
  readonly locale: Locale;
  readonly autoUpdateEnabled: boolean;
  readonly skipAutoTitle: boolean;
  readonly composerWorkMode: ComposerWorkMode;
  readonly revision: number;
  readonly lastError?: string;
}

export interface CreateSessionInput {
  readonly workspaceId: string;
  readonly title?: string;
}

export interface WorkspaceSessionTarget {
  readonly workspaceId: string;
  readonly sessionId: string;
}

export function createEmptyDesktopAppState(): DesktopAppState {
  return {
    workspaces: [],
    worktreesByWorkspace: {},
    selectedWorkspaceId: "",
    selectedSessionId: "",
    activeView: "threads",
    composerDraft: "",
    composerDraftSyncSource: "state",
    composerDraftSyncNonce: 0,
    composerAttachments: [],
    queuedComposerMessages: [],
    runtimeByWorkspace: {},
    sessionCommandsBySession: {},
    sessionExtensionUiBySession: {},
    extensionCommandCompatibilityByWorkspace: {},
    notificationPreferences: {
      backgroundCompletion: true,
      backgroundFailure: true,
      attentionNeeded: true,
    },
    imChannels: [],
    integratedTerminalShell: "",
    lastViewedAtBySession: {},
    workspaceOrder: [],
    modelSettingsScopeMode: "app-global",
    globalModelSettings: {
      enabledModelPatterns: [],
    },
    sidebarCollapsed: false,
    enableTransparency: false,
    locale: "en",
    autoUpdateEnabled: true,
    skipAutoTitle: false,
    composerWorkMode: "pi-agent",
    revision: 0,
  };
}

export function getSelectedWorkspace(state: DesktopAppState): WorkspaceRecord | undefined {
  return state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId);
}

export function getSelectedSession(state: DesktopAppState): SessionRecord | undefined {
  return getSelectedWorkspace(state)?.sessions.find(
    (session) => session.id === state.selectedSessionId && !session.archivedAt,
  );
}
