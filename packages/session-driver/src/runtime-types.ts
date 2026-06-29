import type { WorkspaceRef } from "./types.js";

export type RuntimeAuthType = "oauth" | "api_key" | "none";
export type RuntimeProviderAuthSource = "none" | "oauth" | "auth_file" | "env" | "external";
export type RuntimeSourceScope = "user" | "project" | "temporary";
export type RuntimeSourceOrigin = "package" | "top-level";
export type RuntimeCommandSource = "extension" | "prompt" | "skill";

export interface RuntimeSourceInfo {
  readonly path: string;
  readonly source: string;
  readonly scope: RuntimeSourceScope;
  readonly origin: RuntimeSourceOrigin;
  readonly baseDir?: string;
}

export interface RuntimeProviderRecord {
  readonly id: string;
  readonly name: string;
  readonly hasAuth: boolean;
  readonly authType: RuntimeAuthType;
  readonly authSource: RuntimeProviderAuthSource;
  readonly oauthSupported: boolean;
  readonly apiKeySetupSupported: boolean;
}

export interface RuntimeModelRecord {
  readonly providerId: string;
  readonly providerName: string;
  readonly modelId: string;
  readonly label: string;
  readonly available: boolean;
  readonly authType: RuntimeAuthType;
  readonly reasoning: boolean;
  readonly supportsImages: boolean;
}

export interface RuntimeSkillRecord {
  readonly name: string;
  readonly description: string;
  readonly filePath: string;
  readonly baseDir: string;
  readonly source: string;
  readonly enabled: boolean;
  readonly disableModelInvocation: boolean;
  readonly slashCommand: string;
}

export interface RuntimeExtensionDiagnostic {
  readonly type: "warning" | "error" | "collision";
  readonly message: string;
  readonly path?: string;
}

export interface RuntimeExtensionRecord {
  readonly path: string;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly sourceInfo: RuntimeSourceInfo;
  readonly commands: readonly string[];
  readonly tools: readonly string[];
  readonly flags: readonly string[];
  readonly shortcuts: readonly string[];
  readonly diagnostics: readonly RuntimeExtensionDiagnostic[];
}

export interface RuntimeCommandRecord {
  readonly name: string;
  readonly description?: string;
  readonly source: RuntimeCommandSource;
  readonly sourceInfo: RuntimeSourceInfo;
}

export function normalizeRuntimeCommandName(value: string): string {
  return value.trim().replace(/^\/+/, "");
}

export function runtimeCommandToken(name: string): string {
  return `/${normalizeRuntimeCommandName(name)}`;
}

export function skillCommandName(name: string): string {
  return `skill:${normalizeRuntimeCommandName(name)}`;
}

export function skillSlashCommand(name: string): string {
  return runtimeCommandToken(skillCommandName(name));
}

export interface RuntimeSettingsSnapshot {
  readonly defaultProvider?: string;
  readonly defaultModelId?: string;
  readonly defaultThinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  readonly enableSkillCommands: boolean;
  readonly enabledModelPatterns: readonly string[];
}

export interface ModelSettingsSnapshot {
  readonly defaultProvider?: string;
  readonly defaultModelId?: string;
  readonly defaultThinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  readonly enabledModelPatterns: readonly string[];
}

export interface RuntimeSnapshot {
  readonly workspace: WorkspaceRef;
  readonly providers: readonly RuntimeProviderRecord[];
  readonly models: readonly RuntimeModelRecord[];
  readonly skills: readonly RuntimeSkillRecord[];
  readonly extensions: readonly RuntimeExtensionRecord[];
  readonly settings: RuntimeSettingsSnapshot;
}

/**
 * A configured extension/resource package source (npm/git/local), as tracked by
 * the runtime's package manager. Mirrors the SDK's ConfiguredPackage but is a
 * GUI-owned shape so the renderer never imports the pi runtime SDK directly —
 * keeping the harness↔runtime seam loosely coupled for Pi self-upgrades.
 */
export interface RuntimePackageRecord {
  readonly source: string;
  readonly scope: "user" | "project";
  readonly filtered: boolean;
  readonly installedPath?: string;
}

/** An available update for a configured npm/git package source. */
export interface RuntimePackageUpdate {
  readonly source: string;
  readonly displayName: string;
  readonly type: "npm" | "git";
  readonly scope: "user" | "project";
}

/**
 * One discoverable APPEND_SYSTEM.md file (project- or user-scoped). The pi
 * runtime appends this file's content to the session system prompt. Surfacing
 * it here keeps the file-based prompt seam editable from the harness UI without
 * the harness owning prompt assembly.
 */
export interface RuntimeAppendSystemPromptFile {
  /** Absolute path of the file (whether or not it currently exists). */
  readonly path: string;
  /** Current file content; empty string when the file does not exist. */
  readonly content: string;
  /** Whether the file currently exists on disk. */
  readonly exists: boolean;
}

/**
 * Project- and user-scoped APPEND_SYSTEM.md files plus which one the runtime
 * actually uses. The runtime prefers the project file when it exists, otherwise
 * the user (global) file; `activeScope` reflects that precedence.
 */
export interface RuntimeAppendSystemPrompt {
  readonly project: RuntimeAppendSystemPromptFile;
  readonly global: RuntimeAppendSystemPromptFile;
  readonly activeScope: "project" | "global" | "none";
}

export interface RuntimeLoginAuthInfo {
  readonly url: string;
  readonly instructions?: string;
}

export interface RuntimeLoginPrompt {
  readonly message: string;
  readonly placeholder?: string;
  readonly allowEmpty?: boolean;
}

export interface RuntimeLoginCallbacks {
  readonly onAuth: (info: RuntimeLoginAuthInfo) => void | Promise<void>;
  readonly onPrompt: (prompt: RuntimeLoginPrompt) => Promise<string>;
  readonly onProgress?: (message: string) => void | Promise<void>;
  readonly onManualCodeInput?: () => Promise<string>;
  readonly signal?: AbortSignal;
}

export interface RuntimeResourceDriver {
  getRuntimeSnapshot(workspace: WorkspaceRef): Promise<RuntimeSnapshot>;
  refreshRuntime(workspace: WorkspaceRef): Promise<RuntimeSnapshot>;
  login(workspace: WorkspaceRef, providerId: string, callbacks: RuntimeLoginCallbacks): Promise<RuntimeSnapshot>;
  logout(workspace: WorkspaceRef, providerId: string): Promise<RuntimeSnapshot>;
  setProviderApiKey(workspace: WorkspaceRef, providerId: string, apiKey: string): Promise<RuntimeSnapshot>;
  setDefaultModel(
    workspace: WorkspaceRef,
    selection: {
      readonly provider: string;
      readonly modelId: string;
    },
  ): Promise<RuntimeSnapshot>;
  setDefaultThinkingLevel(
    workspace: WorkspaceRef,
    thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"],
  ): Promise<RuntimeSnapshot>;
  setEnableSkillCommands(workspace: WorkspaceRef, enabled: boolean): Promise<RuntimeSnapshot>;
  setScopedModelPatterns(workspace: WorkspaceRef, patterns: readonly string[]): Promise<RuntimeSnapshot>;
  setSkillEnabled(workspace: WorkspaceRef, filePath: string, enabled: boolean): Promise<RuntimeSnapshot>;
  setExtensionEnabled(workspace: WorkspaceRef, filePath: string, enabled: boolean): Promise<RuntimeSnapshot>;
}
