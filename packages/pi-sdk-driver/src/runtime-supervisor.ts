import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  DefaultPackageManager,
  DefaultResourceLoader,
  type PackageSource,
  SettingsManager,
  parseFrontmatter,
  stripFrontmatter,
  type PathMetadata,
  type ResolvedPaths,
  type ResolvedResource,
} from "@earendil-works/pi-coding-agent";
import type {
  RuntimeAppendSystemPrompt,
  RuntimeAppendSystemPromptFile,
  RuntimeLoginCallbacks,
  RuntimeExtensionDiagnostic,
  RuntimeExtensionRecord,
  RuntimeModelRecord,
  RuntimePackageRecord,
  RuntimePackageUpdate,
  RuntimeProviderRecord,
  RuntimeResourceDriver,
  RuntimeSettingsSnapshot,
  RuntimeSkillRecord,
  RuntimeSourceInfo,
  RuntimeSnapshot,
} from "@pi-gui/session-driver/runtime-types";
import type { WorkspaceRef } from "@pi-gui/session-driver";
import { createRuntimeDependencies } from "./runtime-deps.js";
import { createSettingsManagerWithoutNpmPackages, isGlobalNpmLookupError } from "./npm-package-fallback.js";
import { skillSlashCommand } from "./runtime-command-utils.js";
import type { AuthStatus, AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";

interface ModelSettingsSnapshot {
  readonly defaultProvider?: string;
  readonly defaultModelId?: string;
  readonly defaultThinkingLevel?: RuntimeSettingsSnapshot["defaultThinkingLevel"];
  readonly enabledModelPatterns: readonly string[];
}

interface RuntimeContext {
  readonly workspace: WorkspaceRef;
  readonly settingsManager: SettingsManager;
  readonly packageManager: DefaultPackageManager;
  readonly resourceLoader: DefaultResourceLoader;
}

interface ProjectWritableSettingsManager {
  markProjectModified(field: string, nestedKey?: string): void;
  saveProjectSettings(settings: Record<string, unknown>): void;
}

export interface RuntimeSupervisorOptions {
  readonly agentDir?: string;
  readonly authStorage?: AuthStorage;
  readonly modelRegistry?: ModelRegistry;
}

type ResourceScope = "user" | "project";
type ToggleableResourceKind = "extension" | "skill";

export class RuntimeSupervisor implements RuntimeResourceDriver {
  private readonly agentDir: string;
  private readonly authStorage: AuthStorage;
  private readonly modelRegistry: ModelRegistry;
  private readonly contexts = new Map<string, RuntimeContext>();

  constructor(options: RuntimeSupervisorOptions = {}) {
    const deps = createRuntimeDependencies(options);
    this.agentDir = deps.agentDir;
    this.authStorage = deps.authStorage;
    this.modelRegistry = deps.modelRegistry;
  }

  async getRuntimeSnapshot(workspace: WorkspaceRef): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    return this.buildSnapshot(context);
  }

  async refreshRuntime(workspace: WorkspaceRef): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    context.settingsManager.reload();
    this.authStorage.reload();
    this.modelRegistry.refresh();
    await context.resourceLoader.reload();
    await this.autoEnableModelsForAuthenticatedProviders(context);
    return this.buildSnapshot(context);
  }

  async login(workspace: WorkspaceRef, providerId: string, callbacks: RuntimeLoginCallbacks): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    await this.authStorage.login(providerId, callbacks);
    this.modelRegistry.refresh();
    await context.resourceLoader.reload();
    await this.autoEnableModelsForAuthenticatedProviders(context, [providerId]);
    return this.buildSnapshot(context);
  }

  async logout(workspace: WorkspaceRef, providerId: string): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    this.authStorage.logout(providerId);
    this.modelRegistry.refresh();
    await context.resourceLoader.reload();
    return this.buildSnapshot(context);
  }

  async setProviderApiKey(workspace: WorkspaceRef, providerId: string, apiKey: string): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    const normalized = apiKey.trim();
    if (!normalized) {
      throw new Error("API key is required.");
    }
    if (!providerSupportsDesktopApiKeySetup(providerId)) {
      throw new Error(`API key setup is not supported for ${providerId}.`);
    }
    this.authStorage.set(providerId, { type: "api_key", key: normalized });
    this.modelRegistry.refresh();
    await context.resourceLoader.reload();
    await this.autoEnableModelsForAuthenticatedProviders(context, [providerId]);
    await this.autoSetDefaultModelForFirstProvider(context, providerId);
    return this.buildSnapshot(context);
  }

  async setDefaultModel(
    workspace: WorkspaceRef,
    selection: {
      readonly provider: string;
      readonly modelId: string;
    },
  ): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    context.settingsManager.setDefaultModelAndProvider(selection.provider, selection.modelId);
    await context.settingsManager.flush();
    return this.buildSnapshot(context);
  }

  async setProjectDefaultModel(
    workspace: WorkspaceRef,
    selection: {
      readonly provider: string;
      readonly modelId: string;
    },
  ): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    const settingsManager = context.settingsManager as unknown as ProjectWritableSettingsManager;
    const projectSettings = context.settingsManager.getProjectSettings() as Record<string, unknown>;
    projectSettings.defaultProvider = selection.provider;
    projectSettings.defaultModel = selection.modelId;
    settingsManager.markProjectModified("defaultProvider");
    settingsManager.markProjectModified("defaultModel");
    settingsManager.saveProjectSettings(projectSettings);
    await context.settingsManager.flush();
    context.settingsManager.reload();
    return this.buildSnapshot(context);
  }

  async setDefaultThinkingLevel(
    workspace: WorkspaceRef,
    thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"],
  ): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    if (!thinkingLevel) {
      throw new Error("Thinking level is required.");
    }
    context.settingsManager.setDefaultThinkingLevel(thinkingLevel);
    await context.settingsManager.flush();
    return this.buildSnapshot(context);
  }

  async setProjectDefaultThinkingLevel(
    workspace: WorkspaceRef,
    thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"],
  ): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    if (!thinkingLevel) {
      throw new Error("Thinking level is required.");
    }
    const settingsManager = context.settingsManager as unknown as ProjectWritableSettingsManager;
    const projectSettings = context.settingsManager.getProjectSettings() as Record<string, unknown>;
    projectSettings.defaultThinkingLevel = thinkingLevel;
    settingsManager.markProjectModified("defaultThinkingLevel");
    settingsManager.saveProjectSettings(projectSettings);
    await context.settingsManager.flush();
    context.settingsManager.reload();
    return this.buildSnapshot(context);
  }

  async setEnableSkillCommands(workspace: WorkspaceRef, enabled: boolean): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    context.settingsManager.setEnableSkillCommands(enabled);
    await context.settingsManager.flush();
    await context.resourceLoader.reload();
    return this.buildSnapshot(context);
  }

  async setScopedModelPatterns(workspace: WorkspaceRef, patterns: readonly string[]): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    context.settingsManager.setEnabledModels(patterns.length > 0 ? [...patterns] : undefined);
    await context.settingsManager.flush();
    return this.buildSnapshot(context);
  }

  async setProjectScopedModelPatterns(workspace: WorkspaceRef, patterns: readonly string[]): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    const settingsManager = context.settingsManager as unknown as ProjectWritableSettingsManager;
    const projectSettings = context.settingsManager.getProjectSettings() as Record<string, unknown>;
    projectSettings.enabledModels = patterns.length > 0 ? [...patterns] : undefined;
    settingsManager.markProjectModified("enabledModels");
    settingsManager.saveProjectSettings(projectSettings);
    await context.settingsManager.flush();
    context.settingsManager.reload();
    return this.buildSnapshot(context);
  }

  async getGlobalModelSettings(workspace: WorkspaceRef): Promise<ModelSettingsSnapshot> {
    const context = await this.ensureContext(workspace);
    return toModelSettingsSnapshot(context.settingsManager.getGlobalSettings() as Record<string, unknown>);
  }

  async getCurrentModelSettings(workspace: WorkspaceRef): Promise<ModelSettingsSnapshot> {
    const globalSettings = await readJsonRecord(join(this.agentDir, "settings.json"));
    const projectSettings = await readJsonRecord(join(workspace.path, ".pi", "settings.json"));
    const globalModelSettings = toModelSettingsSnapshot(globalSettings);
    const projectModelSettings = toModelSettingsSnapshot(projectSettings);
    const snapshot: {
      defaultProvider?: string;
      defaultModelId?: string;
      defaultThinkingLevel?: ModelSettingsSnapshot["defaultThinkingLevel"];
      enabledModelPatterns: readonly string[];
    } = {
      enabledModelPatterns: Array.isArray(projectSettings.enabledModels)
        ? projectModelSettings.enabledModelPatterns
        : globalModelSettings.enabledModelPatterns,
    };

    if (Object.prototype.hasOwnProperty.call(projectSettings, "defaultProvider")) {
      if (projectModelSettings.defaultProvider) {
        snapshot.defaultProvider = projectModelSettings.defaultProvider;
      }
    } else if (globalModelSettings.defaultProvider) {
      snapshot.defaultProvider = globalModelSettings.defaultProvider;
    }

    if (Object.prototype.hasOwnProperty.call(projectSettings, "defaultModel")) {
      if (projectModelSettings.defaultModelId) {
        snapshot.defaultModelId = projectModelSettings.defaultModelId;
      }
    } else if (globalModelSettings.defaultModelId) {
      snapshot.defaultModelId = globalModelSettings.defaultModelId;
    }

    if (Object.prototype.hasOwnProperty.call(projectSettings, "defaultThinkingLevel")) {
      if (projectModelSettings.defaultThinkingLevel) {
        snapshot.defaultThinkingLevel = projectModelSettings.defaultThinkingLevel;
      }
    } else if (globalModelSettings.defaultThinkingLevel) {
      snapshot.defaultThinkingLevel = globalModelSettings.defaultThinkingLevel;
    }

    return snapshot;
  }

  async setSkillEnabled(workspace: WorkspaceRef, filePath: string, enabled: boolean): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    const resolvedPaths = await this.resolveRuntimePaths(context);
    const resource = resolvedPaths.skills.find((entry) => resolve(entry.path) === resolve(filePath));
    if (!resource) {
      throw new Error(`Unknown skill: ${filePath}`);
    }

    this.toggleResource(context, resource, enabled, "skill");
    await context.settingsManager.flush();
    await context.resourceLoader.reload();
    return this.buildSnapshot(context);
  }

  async setExtensionEnabled(workspace: WorkspaceRef, filePath: string, enabled: boolean): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    const resolvedPaths = await this.resolveRuntimePaths(context);
    const resource = resolvedPaths.extensions.find((entry) => resolve(entry.path) === resolve(filePath));
    if (!resource) {
      throw new Error(`Unknown extension: ${filePath}`);
    }

    this.toggleResource(context, resource, enabled, "extension");
    await context.settingsManager.flush();
    await context.resourceLoader.reload();
    return this.buildSnapshot(context);
  }

  // ---------------------------------------------------------------------------
  // Package self-upgrade surface.
  //
  // These thinly expose the runtime's own DefaultPackageManager so the desktop
  // Extensions UI can install / remove / update / check extension packages at
  // runtime — i.e. let Pi self-upgrade its capabilities — without the GUI ever
  // touching the pi SDK directly. Each result is mapped to a GUI-owned shape;
  // mutations re-resolve and return a fresh RuntimeSnapshot like every other op.
  // ---------------------------------------------------------------------------

  /** List the configured extension/resource package sources for a workspace. */
  async listPackages(workspace: WorkspaceRef): Promise<readonly RuntimePackageRecord[]> {
    const context = await this.ensureContext(workspace);
    return context.packageManager.listConfiguredPackages().map(toRuntimePackageRecord);
  }

  /** Check configured npm/git package sources for available updates. */
  async checkForPackageUpdates(workspace: WorkspaceRef): Promise<readonly RuntimePackageUpdate[]> {
    const context = await this.ensureContext(workspace);
    const updates = await context.packageManager.checkForAvailableUpdates();
    return updates.map(toRuntimePackageUpdate);
  }

  /** Install (and persist) a new package source, then refresh the snapshot. */
  async installPackage(workspace: WorkspaceRef, source: string): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    const normalized = source.trim();
    if (!normalized) {
      throw new Error("Package source is required.");
    }
    await context.packageManager.installAndPersist(normalized);
    context.settingsManager.reload();
    await context.resourceLoader.reload();
    return this.buildSnapshot(context);
  }

  /** Remove (and persist) a package source, then refresh the snapshot. */
  async removePackage(workspace: WorkspaceRef, source: string): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    const normalized = source.trim();
    if (!normalized) {
      throw new Error("Package source is required.");
    }
    await context.packageManager.removeAndPersist(normalized);
    context.settingsManager.reload();
    await context.resourceLoader.reload();
    return this.buildSnapshot(context);
  }

  /** Update one package source (or all when omitted), then refresh the snapshot. */
  async updatePackages(workspace: WorkspaceRef, source?: string): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    const normalized = source?.trim();
    await context.packageManager.update(normalized || undefined);
    context.settingsManager.reload();
    await context.resourceLoader.reload();
    return this.buildSnapshot(context);
  }

  /**
   * Read the project- and user-scoped APPEND_SYSTEM.md files for {@link workspace}.
   * Paths mirror the pi runtime's discovery: `<cwd>/.pi/APPEND_SYSTEM.md`
   * (project) and `<agentDir>/APPEND_SYSTEM.md` (user/global). The runtime
   * prefers the project file when present, otherwise the global file.
   */
  async getAppendSystemPrompt(workspace: WorkspaceRef): Promise<RuntimeAppendSystemPrompt> {
    const projectPath = join(workspace.path, ".pi", "APPEND_SYSTEM.md");
    const globalPath = join(this.agentDir, "APPEND_SYSTEM.md");
    const [project, global] = await Promise.all([
      readAppendSystemPromptFile(projectPath),
      readAppendSystemPromptFile(globalPath),
    ]);
    const activeScope: RuntimeAppendSystemPrompt["activeScope"] = project.exists
      ? "project"
      : global.exists
        ? "global"
        : "none";
    return { project, global, activeScope };
  }

  /**
   * Write the APPEND_SYSTEM.md file for the given scope. An empty/whitespace-only
   * body removes the file so it stops contributing to the prompt and stops
   * shadowing the other scope. Reloads the resource loader so the change is
   * reflected without restarting the workspace.
   */
  async setAppendSystemPrompt(
    workspace: WorkspaceRef,
    scope: "project" | "global",
    content: string,
  ): Promise<RuntimeAppendSystemPrompt> {
    const targetPath =
      scope === "project"
        ? join(workspace.path, ".pi", "APPEND_SYSTEM.md")
        : join(this.agentDir, "APPEND_SYSTEM.md");
    await writeAppendSystemPromptFile(targetPath, content);
    const context = this.contexts.get(workspace.workspaceId);
    if (context) {
      await context.resourceLoader.reload();
    }
    return this.getAppendSystemPrompt(workspace);
  }

  private async ensureContext(workspace: WorkspaceRef): Promise<RuntimeContext> {
    const existing = this.contexts.get(workspace.workspaceId);
    if (existing) {
      return existing;
    }

    let settingsManager = SettingsManager.create(workspace.path, this.agentDir);
    let packageManager = new DefaultPackageManager({
      cwd: workspace.path,
      agentDir: this.agentDir,
      settingsManager,
    });
    let resourceLoader = new DefaultResourceLoader({
      cwd: workspace.path,
      agentDir: this.agentDir,
      settingsManager,
    });
    try {
      await resourceLoader.reload();
    } catch (error) {
      if (!isGlobalNpmLookupError(error)) {
        throw error;
      }

      const fallbackSettingsManager = createSettingsManagerWithoutNpmPackages(settingsManager);
      if (!fallbackSettingsManager) {
        throw error;
      }

      console.warn(
        `[pi-deepseek] Falling back to runtime resource loading without npm package sources for ${workspace.path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      settingsManager = fallbackSettingsManager;
      packageManager = new DefaultPackageManager({
        cwd: workspace.path,
        agentDir: this.agentDir,
        settingsManager,
      });
      resourceLoader = new DefaultResourceLoader({
        cwd: workspace.path,
        agentDir: this.agentDir,
        settingsManager,
      });
      await resourceLoader.reload();
    }

    const context: RuntimeContext = {
      workspace,
      settingsManager,
      packageManager,
      resourceLoader,
    };
    this.contexts.set(workspace.workspaceId, context);
    return context;
  }

  private async buildSnapshot(context: RuntimeContext): Promise<RuntimeSnapshot> {
    const resolvedPaths = await this.resolveRuntimePaths(context);
    const [skills, extensions, providers, models] = await Promise.all([
      this.buildSkillRecords(context, resolvedPaths.skills),
      this.buildExtensionRecords(context, resolvedPaths.extensions),
      this.buildProviderRecords(),
      this.buildModelRecords(),
    ]);

    const defaultProvider = context.settingsManager.getDefaultProvider();
    const defaultModelId = context.settingsManager.getDefaultModel();
    const defaultThinkingLevel = context.settingsManager.getDefaultThinkingLevel();
    const settings: RuntimeSettingsSnapshot = {
      ...(defaultProvider ? { defaultProvider } : {}),
      ...(defaultModelId ? { defaultModelId } : {}),
      ...(defaultThinkingLevel ? { defaultThinkingLevel } : {}),
      enableSkillCommands: context.settingsManager.getEnableSkillCommands(),
      enabledModelPatterns: context.settingsManager.getEnabledModels() ?? [],
    };

    return {
      workspace: context.workspace,
      providers,
      models,
      skills,
      extensions,
      settings,
    };
  }

  private async resolveRuntimePaths(context: RuntimeContext): Promise<ResolvedPaths> {
    try {
      return await context.packageManager.resolve();
    } catch (error) {
      if (!isGlobalNpmLookupError(error)) {
        throw error;
      }

      const fallbackSettingsManager = createSettingsManagerWithoutNpmPackages(context.settingsManager);
      if (!fallbackSettingsManager) {
        throw error;
      }

      console.warn(
        `[pi-deepseek] Falling back to runtime package resolution without npm package sources for ${context.workspace.path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      const fallbackPackageManager = new DefaultPackageManager({
        cwd: context.workspace.path,
        agentDir: this.agentDir,
        settingsManager: fallbackSettingsManager,
      });
      return fallbackPackageManager.resolve();
    }
  }

  private async buildProviderRecords(): Promise<readonly RuntimeProviderRecord[]> {
    const oauthProviders = new Map(this.authStorage.getOAuthProviders().map((provider) => [provider.id, provider]));
    const providerIds = new Set<string>([
      ...this.modelRegistry.getAll().map((model) => model.provider),
      ...oauthProviders.keys(),
      ...this.authStorage.list(),
    ]);

    return [...providerIds]
      .sort((left, right) => {
        // Pin DeepSeek at the top for first-launch convenience.
        if (left === "deepseek") return -1;
        if (right === "deepseek") return 1;
        return left.localeCompare(right);
      })
      .map((providerId) => {
        const auth = this.authStorage.get(providerId);
        const oauthProvider = oauthProviders.get(providerId);
        const apiKeySetupSupported = providerSupportsDesktopApiKeySetup(providerId);
        const providerAuthStatus = this.modelRegistry.getProviderAuthStatus(providerId);
        const hasAuth = providerAuthStatus.configured || this.authStorage.hasAuth(providerId);
        return {
          id: providerId,
          name: oauthProvider?.name ?? providerId,
          hasAuth,
          authType: auth?.type ?? "none",
          authSource: inferProviderAuthSource(auth, providerAuthStatus, apiKeySetupSupported),
          oauthSupported: Boolean(oauthProvider),
          apiKeySetupSupported,
        };
      });
  }

  private async buildModelRecords(): Promise<readonly RuntimeModelRecord[]> {
    this.modelRegistry.refresh();
    const availableKeys = new Set(
      (await this.modelRegistry.getAvailable()).map((model) => `${model.provider}:${model.id}`),
    );
    const providers = new Map((await this.buildProviderRecords()).map((provider) => [provider.id, provider]));

    return this.modelRegistry
      .getAll()
      .map<RuntimeModelRecord>((model) => {
        const provider = providers.get(model.provider);
        return {
          providerId: model.provider,
          providerName: provider?.name ?? model.provider,
          modelId: model.id,
          label: model.name,
          available: availableKeys.has(`${model.provider}:${model.id}`),
          authType: provider?.authType ?? "none",
          reasoning: Boolean(model.reasoning),
          supportsImages: model.input.includes("image"),
        };
      })
      .sort((left, right) =>
        left.providerId === right.providerId
          ? left.modelId.localeCompare(right.modelId)
          : left.providerId.localeCompare(right.providerId),
      );
  }

  private async autoSetDefaultModelForFirstProvider(
    context: RuntimeContext,
    providerId: string,
  ): Promise<void> {
    const currentDefault = context.settingsManager.getDefaultProvider();
    if (currentDefault) {
      return;
    }

    const models = this.modelRegistry.getAvailable();
    const providerModels = models.filter((model) => model.provider === providerId);
    if (providerModels.length === 0) {
      return;
    }

    // Prefer V4 Pro for deepseek; otherwise use the first available model.
    const preferredModel =
      providerId === "deepseek"
        ? providerModels.find((model) => model.id.startsWith("deepseek-v4-pro"))
        : undefined;
    const model = preferredModel ?? providerModels[0];

    context.settingsManager.setDefaultModelAndProvider(providerId, model!.id);
    await context.settingsManager.flush();
  }

  private async autoEnableModelsForAuthenticatedProviders(
    context: RuntimeContext,
    providerIds?: readonly string[],
  ): Promise<void> {
    const currentPatterns = context.settingsManager.getEnabledModels() ?? [];
    if (currentPatterns.length === 0) {
      return;
    }

    const providers = await this.buildProviderRecords();
    const models = await this.buildModelRecords();
    const hasSelectableModels = models.some((model) =>
      model.available && currentPatterns.includes(`${model.providerId}/${model.modelId}`),
    );
    const candidateProviderIds =
      providerIds && providerIds.length > 0
        ? providerIds
        : hasSelectableModels
          ? []
          : providers
              .filter((provider) => provider.hasAuth)
              .map((provider) => provider.id);
    if (candidateProviderIds.length === 0) {
      return;
    }

    const candidateProviderSet = new Set(candidateProviderIds);
    const nextPatterns = mergeEnabledModelPatterns(
      currentPatterns,
      models
        .filter((model) => model.available && candidateProviderSet.has(model.providerId))
        .map((model) => `${model.providerId}/${model.modelId}`),
    );
    if (nextPatterns.length === currentPatterns.length) {
      return;
    }

    context.settingsManager.setEnabledModels([...nextPatterns]);
    await context.settingsManager.flush();
  }

  private async buildSkillRecords(
    context: RuntimeContext,
    resolvedSkills: readonly ResolvedResource[],
  ): Promise<readonly RuntimeSkillRecord[]> {
    const loadedSkills = new Map(
      context.resourceLoader
        .getSkills()
        .skills.map((skill) => [resolve(skill.filePath), skill] as const),
    );

    const records = await Promise.all(
      resolvedSkills.map(async (resource) => {
        const filePath = resolve(resource.path);
        const loaded = loadedSkills.get(filePath);
        const fallback = loaded ? undefined : await readSkillMetadata(filePath);
        const name = loaded?.name ?? fallback?.name ?? inferSkillName(filePath);
        const description = loaded?.description ?? fallback?.description ?? "No description provided.";
        const disableModelInvocation = loaded?.disableModelInvocation ?? fallback?.disableModelInvocation ?? false;

        return {
          name,
          description,
          filePath,
          baseDir: loaded?.baseDir ?? dirname(filePath),
          source: resource.metadata.source,
          enabled: resource.enabled,
          disableModelInvocation,
          slashCommand: skillSlashCommand(name),
        } satisfies RuntimeSkillRecord;
      }),
    );

    return records.sort((left: RuntimeSkillRecord, right: RuntimeSkillRecord) => left.name.localeCompare(right.name));
  }

  private async buildExtensionRecords(
    context: RuntimeContext,
    resolvedExtensions: readonly ResolvedResource[],
  ): Promise<readonly RuntimeExtensionRecord[]> {
    const loadedResult = context.resourceLoader.getExtensions();
    const packageDisplayNameCache = new Map<string, Promise<string | undefined>>();
    const loadedByPath = new Map(
      loadedResult.extensions.map((extension) => [resolve(extension.resolvedPath || extension.path), extension] as const),
    );
    const diagnosticsByPath = new Map<string, RuntimeExtensionDiagnostic[]>();

    for (const error of loadedResult.errors) {
      const diagnostics = diagnosticsByPath.get(resolve(error.path)) ?? [];
      diagnostics.push({
        type: "error",
        message: error.error,
        path: error.path,
      });
      diagnosticsByPath.set(resolve(error.path), diagnostics);
    }

    const records = await Promise.all(
      resolvedExtensions.map<Promise<RuntimeExtensionRecord>>(async (resource) => {
        const path = resolve(resource.path);
        const loaded = loadedByPath.get(path);
        return {
          path,
          displayName: await inferExtensionDisplayName(path, resource.metadata, packageDisplayNameCache),
          enabled: resource.enabled,
          sourceInfo: toRuntimeSourceInfo(path, resource.metadata),
          commands: loaded ? [...loaded.commands.keys()].sort((left, right) => left.localeCompare(right)) : [],
          tools: loaded
            ? [...loaded.tools.values()]
                .map((tool) => tool.definition.name)
                .sort((left, right) => left.localeCompare(right))
            : [],
          flags: loaded ? [...loaded.flags.keys()].sort((left, right) => left.localeCompare(right)) : [],
          shortcuts: loaded ? [...loaded.shortcuts.keys()].sort((left, right) => left.localeCompare(right)) : [],
          diagnostics: diagnosticsByPath.get(path) ?? [],
        };
      }),
    );

    return records.sort((left, right) =>
      left.displayName === right.displayName
        ? left.path.localeCompare(right.path)
        : left.displayName.localeCompare(right.displayName),
    );
  }

  private toggleResource(
    context: RuntimeContext,
    resource: ResolvedResource,
    enabled: boolean,
    kind: ToggleableResourceKind,
  ): void {
    const { settingsManager } = context;
    const scope = resource.metadata.scope;
    if (scope !== "project" && scope !== "user") {
      throw new Error(`Cannot update ${kind} at scope ${scope}`);
    }
    const origin = resource.metadata.origin;
    const settings = scope === "project" ? settingsManager.getProjectSettings() : settingsManager.getGlobalSettings();
    const pattern = this.relativeResourcePattern(resource.path, resource.metadata, scope, origin);

    if (origin === "top-level") {
      const currentPaths = kind === "skill" ? [...(settings.skills ?? [])] : [...(settings.extensions ?? [])];
      const updated = replaceResourcePattern(currentPaths, pattern, enabled);
      this.setTopLevelResourcePaths(settingsManager, scope, kind, updated);
      return;
    }

    const packages = [...(settings.packages ?? [])];
    const source = resource.metadata.source;
    const packageIndex = packages.findIndex((entry) => (typeof entry === "string" ? entry : entry.source) === source);
    if (packageIndex < 0) {
      throw new Error(`${titleForResourceKind(kind)} package source not found for ${resource.path}`);
    }

    const currentPackage = packages[packageIndex];
    const nextPackage = typeof currentPackage === "string" ? { source: currentPackage } : { ...currentPackage };
    const currentPatterns = kind === "skill" ? [...(nextPackage.skills ?? [])] : [...(nextPackage.extensions ?? [])];
    const updatedPatterns = replaceResourcePattern(currentPatterns, pattern, enabled);
    if (updatedPatterns.length > 0) {
      if (kind === "skill") {
        nextPackage.skills = updatedPatterns;
      } else {
        nextPackage.extensions = updatedPatterns;
      }
    } else {
      if (kind === "skill") {
        delete nextPackage.skills;
      } else {
        delete nextPackage.extensions;
      }
    }

    const hasFilters = ["skills", "extensions", "prompts", "themes"].some((key) =>
      Object.prototype.hasOwnProperty.call(nextPackage, key),
    );
    packages[packageIndex] = (hasFilters ? nextPackage : nextPackage.source) as PackageSource;

    if (scope === "project") {
      settingsManager.setProjectPackages(packages);
    } else {
      settingsManager.setPackages(packages);
    }
  }

  private setTopLevelResourcePaths(
    settingsManager: SettingsManager,
    scope: ResourceScope,
    kind: ToggleableResourceKind,
    paths: string[],
  ): void {
    if (kind === "skill") {
      if (scope === "project") {
        settingsManager.setProjectSkillPaths(paths);
      } else {
        settingsManager.setSkillPaths(paths);
      }
      return;
    }

    if (scope === "project") {
      settingsManager.setProjectExtensionPaths(paths);
    } else {
      settingsManager.setExtensionPaths(paths);
    }
  }

  private relativeResourcePattern(
    filePath: string,
    metadata: PathMetadata,
    scope: ResourceScope,
    origin: PathMetadata["origin"],
  ): string {
    if (origin === "package") {
      const baseDir = metadata.baseDir ?? dirname(filePath);
      return relative(baseDir, filePath);
    }

    const baseDir = metadata.baseDir ?? (scope === "project" ? dirname(filePath) : this.agentDir);
    return relative(baseDir, filePath);
  }
}

async function readJsonRecord(filePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function readAppendSystemPromptFile(filePath: string): Promise<RuntimeAppendSystemPromptFile> {
  try {
    const content = await readFile(filePath, "utf8");
    return { path: filePath, content, exists: true };
  } catch {
    return { path: filePath, content: "", exists: false };
  }
}

async function writeAppendSystemPromptFile(filePath: string, content: string): Promise<void> {
  if (content.trim().length === 0) {
    // Empty body ⇒ remove the file so it neither contributes to the prompt nor
    // shadows the other scope. Missing file is not an error.
    await rm(filePath, { force: true });
    return;
  }
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

function replaceResourcePattern(patterns: readonly string[], resourcePattern: string, enabled: boolean): string[] {
  const next = patterns.filter((pattern) => stripPrefix(pattern) !== resourcePattern);
  next.push(`${enabled ? "+" : "-"}${resourcePattern}`);
  return next;
}

function stripPrefix(pattern: string): string {
  return pattern.startsWith("+") || pattern.startsWith("-") || pattern.startsWith("!") ? pattern.slice(1) : pattern;
}

async function readSkillMetadata(
  filePath: string,
): Promise<{ name?: string; description?: string; disableModelInvocation?: boolean } | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    const frontmatter = parseFrontmatter(raw) as
      | {
          name?: string;
          description?: string;
          "disable-model-invocation"?: boolean;
        }
      | undefined;
    const body = stripFrontmatter(raw);
    const metadata: { name?: string; description?: string; disableModelInvocation?: boolean } = {};
    if (frontmatter?.name) {
      metadata.name = frontmatter.name;
    }
    const description = frontmatter?.description ?? firstNonEmptyLine(body);
    if (description) {
      metadata.description = description;
    }
    if (frontmatter?.["disable-model-invocation"] !== undefined) {
      metadata.disableModelInvocation = frontmatter["disable-model-invocation"];
    }
    return metadata;
  } catch {
    return undefined;
  }
}

function inferSkillName(filePath: string): string {
  const parent = basename(dirname(filePath));
  if (basename(filePath).toLowerCase() === "skill.md" && parent) {
    return parent;
  }
  return basename(filePath).replace(/\.md$/i, "");
}

async function inferExtensionDisplayName(
  filePath: string,
  metadata: PathMetadata,
  packageDisplayNameCache: Map<string, Promise<string | undefined>>,
): Promise<string> {
  if (metadata.origin === "package" && metadata.baseDir) {
    const packageDisplayName = await inferPackageDisplayName(metadata.baseDir, packageDisplayNameCache);
    if (packageDisplayName) {
      return packageDisplayName;
    }
  }

  const entryName = inferExtensionEntryName(filePath);
  if (entryName.toLowerCase() === "index") {
    const packageDisplayName = await inferPackageDisplayName(dirname(filePath), packageDisplayNameCache);
    if (packageDisplayName) {
      return packageDisplayName;
    }
  }

  return entryName;
}

function inferExtensionEntryName(filePath: string): string {
  return basename(filePath).replace(/\.(c|m)?(t|j)sx?$/i, "");
}

async function inferPackageDisplayName(
  packageRoot: string,
  packageDisplayNameCache: Map<string, Promise<string | undefined>>,
): Promise<string | undefined> {
  const normalizedRoot = resolve(packageRoot);
  const cached = packageDisplayNameCache.get(normalizedRoot);
  if (cached) {
    return cached;
  }

  const pending = readPackageDisplayName(normalizedRoot);
  packageDisplayNameCache.set(normalizedRoot, pending);
  return pending;
}

async function readPackageDisplayName(packageRoot: string): Promise<string | undefined> {
  const folderName = basename(packageRoot).trim();
  const packageJson = await readJsonRecord(join(packageRoot, "package.json")) as {
    readonly displayName?: unknown;
  };
  if (typeof packageJson.displayName === "string" && packageJson.displayName.trim()) {
    return packageJson.displayName.trim();
  }

  return folderName || undefined;
}

const DESKTOP_API_KEY_PROVIDER_IDS = new Set([
  "azure-openai-responses",
  "cerebras",
  "deepseek",
  "google",
  "groq",
  "huggingface",
  "kimi-coding",
  "minimax",
  "minimax-cn",
  "mistral",
  "openai",
  "opencode",
  "opencode-go",
  "openrouter",
  "vercel-ai-gateway",
  "xai",
  "zai",
]);

function providerSupportsDesktopApiKeySetup(providerId: string): boolean {
  return DESKTOP_API_KEY_PROVIDER_IDS.has(providerId);
}

function inferProviderAuthSource(
  auth: { readonly type: "oauth" | "api_key" } | undefined,
  providerAuthStatus: AuthStatus,
  apiKeySetupSupported: boolean,
): "none" | "oauth" | "auth_file" | "env" | "external" {
  if (auth?.type === "oauth") {
    return "oauth";
  }
  if (auth?.type === "api_key") {
    return "auth_file";
  }
  switch (providerAuthStatus.source) {
    case "stored":
      return "auth_file";
    case "environment":
      return "env";
    case "fallback":
    case "models_json_command":
    case "models_json_key":
    case "runtime":
      return "external";
  }
  if (!providerAuthStatus.configured) {
    return "none";
  }
  return apiKeySetupSupported ? "env" : "external";
}

function toRuntimeSourceInfo(path: string, metadata: PathMetadata): RuntimeSourceInfo {
  return {
    path,
    source: metadata.source,
    scope: metadata.scope,
    origin: metadata.origin,
    ...(metadata.baseDir ? { baseDir: metadata.baseDir } : {}),
  };
}

function titleForResourceKind(kind: ToggleableResourceKind): string {
  return kind === "skill" ? "Skill" : "Extension";
}

/** Map the SDK's ConfiguredPackage to the GUI-owned RuntimePackageRecord. */
function toRuntimePackageRecord(pkg: {
  source: string;
  scope: "user" | "project";
  filtered: boolean;
  installedPath?: string;
}): RuntimePackageRecord {
  return {
    source: pkg.source,
    scope: pkg.scope,
    filtered: pkg.filtered,
    ...(pkg.installedPath ? { installedPath: pkg.installedPath } : {}),
  };
}

/** Map the SDK's PackageUpdate to the GUI-owned RuntimePackageUpdate. */
function toRuntimePackageUpdate(update: {
  source: string;
  displayName: string;
  type: "npm" | "git";
  scope: "user" | "project";
}): RuntimePackageUpdate {
  return {
    source: update.source,
    displayName: update.displayName,
    type: update.type,
    scope: update.scope,
  };
}

function toModelSettingsSnapshot(settings: Record<string, unknown>): ModelSettingsSnapshot {
  return {
    enabledModelPatterns: Array.isArray(settings.enabledModels)
      ? settings.enabledModels.filter((value): value is string => typeof value === "string")
      : [],
    ...(typeof settings.defaultProvider === "string" ? { defaultProvider: settings.defaultProvider } : {}),
    ...(typeof settings.defaultModel === "string" ? { defaultModelId: settings.defaultModel } : {}),
    ...(typeof settings.defaultThinkingLevel === "string"
      ? { defaultThinkingLevel: settings.defaultThinkingLevel as ModelSettingsSnapshot["defaultThinkingLevel"] }
      : {}),
  } satisfies ModelSettingsSnapshot;
}

function mergeEnabledModelPatterns(
  existingPatterns: readonly string[],
  providerPatterns: readonly string[],
): readonly string[] {
  const merged = [...existingPatterns];
  const seen = new Set(existingPatterns);
  for (const pattern of providerPatterns) {
    if (seen.has(pattern)) {
      continue;
    }
    seen.add(pattern);
    merged.push(pattern);
  }
  return merged;
}

function firstNonEmptyLine(value: string): string | undefined {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}
