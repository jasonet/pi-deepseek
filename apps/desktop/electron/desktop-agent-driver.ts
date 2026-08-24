import type {
  SessionCatalogSnapshot,
  WorkspaceCatalogSnapshot,
  WorkspaceId,
} from "@pi-gui/catalogs";
import {
  PiSdkDriver,
  type GenerateThreadTitleOptions,
  type PiSdkDriverConfig,
  type SessionFileCatalogStorage,
  type SyncWorkspaceResult,
} from "@pi-gui/pi-sdk-driver";
import type {
  CreateSessionOptions,
  HostUiResponse,
  NavigateSessionTreeOptions,
  SessionDriver,
  SessionEventListener,
  SessionMessageInput,
  SessionModelSelection,
  SessionQueuedMessage,
  SessionRef,
  WorkspaceRef,
} from "@pi-gui/session-driver";
import { FxAcpDriver, isFxSession } from "./fx-acp-driver";

export interface DesktopAgentDriverOptions extends PiSdkDriverConfig {
  readonly catalogStorage: SessionFileCatalogStorage;
  readonly fxBundledRoot?: string;
  readonly fxBinaryPath?: string;
}

export class DesktopAgentDriver implements SessionDriver {
  readonly pi: PiSdkDriver;
  readonly fx: FxAcpDriver;
  private readonly catalogStorage: SessionFileCatalogStorage;

  constructor(options: DesktopAgentDriverOptions) {
    this.catalogStorage = options.catalogStorage;
    this.pi = new PiSdkDriver(options);
    this.fx = new FxAcpDriver({
      catalogs: options.catalogStorage,
      ...(options.fxBundledRoot ? { bundledRoot: options.fxBundledRoot } : {}),
      ...(options.fxBinaryPath ? { binaryPath: options.fxBinaryPath } : {}),
    });
  }

  get runtimeSupervisor() {
    return this.pi.runtimeSupervisor;
  }
  get systemPromptComposer() {
    return this.pi.systemPromptComposer;
  }
  isFxAvailable(): Promise<boolean> {
    if (process.env.PI_APP_TEST_MODE && process.env.PI_FX_ENABLED !== "1")
      return Promise.resolve(false);
    return this.fx.isAvailable();
  }
  createSession(workspace: WorkspaceRef, options?: CreateSessionOptions) {
    return options?.backendId === "fx"
      ? this.fx.createSession(workspace, options)
      : this.pi.createSession(workspace, options);
  }
  openSession(ref: SessionRef) {
    return this.for(ref).openSession(ref);
  }
  archiveSession(ref: SessionRef) {
    return this.for(ref).archiveSession(ref);
  }
  unarchiveSession(ref: SessionRef) {
    return this.for(ref).unarchiveSession(ref);
  }
  sendUserMessage(ref: SessionRef, input: SessionMessageInput) {
    return this.for(ref).sendUserMessage(ref, input);
  }
  replaceQueuedMessages(
    ref: SessionRef,
    messages: readonly SessionQueuedMessage[],
  ) {
    return this.for(ref).replaceQueuedMessages(ref, messages);
  }
  cancelCurrentRun(ref: SessionRef) {
    return this.for(ref).cancelCurrentRun(ref);
  }
  setSessionModel(ref: SessionRef, selection: SessionModelSelection) {
    return this.for(ref).setSessionModel(ref, selection);
  }
  setSessionThinkingLevel(ref: SessionRef, level: string) {
    return this.for(ref).setSessionThinkingLevel(ref, level);
  }
  renameSession(ref: SessionRef, title: string) {
    return this.for(ref).renameSession(ref, title);
  }
  compactSession(ref: SessionRef, instructions?: string) {
    return this.for(ref).compactSession(ref, instructions);
  }
  reloadSession(ref: SessionRef) {
    return this.for(ref).reloadSession(ref);
  }
  getSessionTree(ref: SessionRef) {
    return this.for(ref).getSessionTree(ref);
  }
  navigateSessionTree(
    ref: SessionRef,
    targetId: string,
    options?: NavigateSessionTreeOptions,
  ) {
    return this.for(ref).navigateSessionTree(ref, targetId, options);
  }
  getSessionCommands(ref: SessionRef) {
    return this.for(ref).getSessionCommands(ref);
  }
  respondToHostUiRequest(ref: SessionRef, response: HostUiResponse) {
    return this.for(ref).respondToHostUiRequest(ref, response);
  }
  subscribe(ref: SessionRef, listener: SessionEventListener) {
    return this.for(ref).subscribe(ref, listener);
  }
  closeSession(ref: SessionRef) {
    return this.for(ref).closeSession(ref);
  }
  listWorkspaces(): Promise<WorkspaceCatalogSnapshot> {
    return this.pi.listWorkspaces();
  }
  listSessions(workspaceId?: WorkspaceId): Promise<SessionCatalogSnapshot> {
    return this.pi.listSessions(workspaceId);
  }
  syncWorkspace(
    path: string,
    displayName?: string,
  ): Promise<SyncWorkspaceResult> {
    return this.pi.syncWorkspace(path, displayName);
  }
  renameWorkspace(workspaceId: WorkspaceId, displayName: string) {
    return this.pi.renameWorkspace(workspaceId, displayName);
  }
  async removeWorkspace(workspaceId: WorkspaceId) {
    const { sessions } = await this.pi.listSessions(workspaceId);
    await Promise.all(
      sessions
        .filter((session) => session.backendId === "fx")
        .map((session) => this.fx.closeSession(session.sessionRef)),
    );
    return this.pi.removeWorkspace(workspaceId);
  }
  async discardFxSession(ref: SessionRef): Promise<void> {
    await this.fx.closeSession(ref);
    await this.catalogStorage.sessions.deleteSession(ref);
  }
  getTranscript(ref: SessionRef) {
    return isFxSession(ref)
      ? this.fx.getTranscript(ref)
      : this.pi.getTranscript(ref);
  }
  generateThreadTitle(
    workspace: WorkspaceRef,
    options: GenerateThreadTitleOptions,
  ) {
    return this.pi.generateThreadTitle(workspace, options);
  }
  private for(ref: SessionRef): SessionDriver {
    return isFxSession(ref) ? this.fx : this.pi;
  }
}
