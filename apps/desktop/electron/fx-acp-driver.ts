import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  sessionKey,
  type SessionFileCatalogStorage,
  type SessionTranscriptMessage,
} from "@pi-gui/pi-sdk-driver";
import type {
  CreateSessionOptions,
  HostUiResponse,
  NavigateSessionTreeOptions,
  NavigateSessionTreeResult,
  SessionDriver,
  SessionDriverEvent,
  SessionEventListener,
  SessionMessageInput,
  SessionModelSelection,
  SessionQueuedMessage,
  SessionRef,
  SessionSnapshot,
  SessionTreeSnapshot,
  Unsubscribe,
  WorkspaceRef,
} from "@pi-gui/session-driver";
import {
  isFxRuntimeProvider,
  parseFxAuthStatus,
  toFxRuntimeProvider,
  withFxModels,
  type FxAuthProvider,
  type FxAuthStatus,
} from "../src/fx-auth";

const FX_SESSION_PREFIX = "fx:";
const FX_CONTROL_REQUEST_TIMEOUT_MS = 20_000;
const FX_IDLE_CLIENT_TIMEOUT_MS = 5 * 60_000;
const FX_TRANSCRIPT_MESSAGE_LIMIT = 500;
const FX_ASSISTANT_DELTA_BATCH_MS = 24;
const FX_STATUS_TIMEOUT_MS = 15_000;
const FX_LOGIN_TIMEOUT_MS = 10 * 60_000;
const FX_CLI_OUTPUT_LIMIT = 128 * 1024;

type JsonObject = Record<string, unknown>;

interface ManagedFxSession {
  snapshot: SessionSnapshot;
  companionSessionId?: string;
  listeners: Set<SessionEventListener>;
  transcript: SessionTranscriptMessage[];
  client?: FxAcpClient;
  assistantBuffer: string;
  activeRunId?: string;
  permissionOptions: Map<string, Map<string, string>>;
  eventQueue: Promise<void>;
  pendingAssistantDelta?: Extract<
    SessionDriverEvent,
    { type: "assistantDelta" }
  >;
  assistantDeltaTimer?: NodeJS.Timeout;
  loadingHistory: boolean;
  disposed: boolean;
  idleTimer?: NodeJS.Timeout;
}

export interface FxAcpDriverOptions {
  readonly catalogs: SessionFileCatalogStorage;
  readonly bundledRoot?: string;
  readonly binaryPath?: string;
}

export class FxAcpDriver implements SessionDriver {
  private readonly catalogs: SessionFileCatalogStorage;
  private readonly bundledRoot: string | undefined;
  private readonly binaryPath: string | undefined;
  private readonly records = new Map<string, ManagedFxSession>();

  constructor(options: FxAcpDriverOptions) {
    this.catalogs = options.catalogs;
    this.bundledRoot = options.bundledRoot;
    this.binaryPath = options.binaryPath;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(
      await resolveFxBinary({
        bundledRoot: this.bundledRoot,
        binaryPath: this.binaryPath,
      }),
    );
  }

  async getDefaultModelSelection(): Promise<SessionModelSelection | undefined> {
    return readFxDefaultModelSelection();
  }

  async getAuthStatus(workspacePath: string): Promise<FxAuthStatus> {
    const inspected = await this.inspectCli(workspacePath);
    return inspected?.status ?? {
      state: "unavailable",
      connectedProviders: [],
      models: [],
      message: "fx runtime is unavailable.",
    };
  }

  async loginProvider(workspacePath: string, provider: FxAuthProvider): Promise<FxAuthStatus> {
    const inspected = await this.inspectCli(workspacePath);
    if (!inspected) {
      throw new Error("fx runtime is unavailable. Reinstall the app to restore the bundled runtime.");
    }

    const loginArgs = provider === "vercel" ? ["login"] : ["login", provider];
    await runFxCli(inspected.binary, loginArgs, workspacePath, FX_LOGIN_TIMEOUT_MS);

    // `fx login <provider>` also activates that provider. Account connection in
    // the desktop settings is intentionally non-destructive: restore the user's
    // prior active provider after the new credential has been saved.
    const previousProvider = inspected.status.activeProvider;
    if (previousProvider && previousProvider !== provider) {
      await runFxCli(
        inspected.binary,
        ["provider", toFxRuntimeProvider(previousProvider)],
        workspacePath,
        FX_STATUS_TIMEOUT_MS,
      );
    }

    const refreshed = await inspectFxCliBinary(inspected.binary, workspacePath);
    if (!refreshed) {
      throw new Error("fx login completed, but its updated account status could not be read.");
    }
    return refreshed;
  }

  async selectProvider(workspacePath: string, provider: FxAuthProvider): Promise<FxAuthStatus> {
    const inspected = await this.inspectCli(workspacePath);
    if (!inspected) throw new Error("fx runtime is unavailable.");
    if (!inspected.status.connectedProviders.includes(provider)) {
      throw new Error("Connect this fx provider before selecting it.");
    }
    await runFxCli(
      inspected.binary,
      ["provider", toFxRuntimeProvider(provider)],
      workspacePath,
      FX_STATUS_TIMEOUT_MS,
    );
    const refreshed = await inspectFxCliBinary(inspected.binary, workspacePath);
    if (!refreshed) throw new Error("fx provider changed, but its model catalog could not be read.");
    return refreshed;
  }

  async createSession(
    workspace: WorkspaceRef,
    options: CreateSessionOptions = {},
  ): Promise<SessionSnapshot> {
    const { client, result } = await this.connectAndRequest(
      workspace,
      "session/new",
      { cwd: workspace.path, mcpServers: [] },
    );
    const rawSessionId = stringField(result, "sessionId");
    if (!rawSessionId) {
      client.close();
      throw new Error("fx ACP did not return a session ID.");
    }
    const ref = {
      workspaceId: workspace.workspaceId,
      sessionId: toFxSessionId(rawSessionId),
    };
    const now = new Date().toISOString();
    const initialConfig = configFromAcpResult(result);
    const snapshot: SessionSnapshot = {
      backendId: "fx",
      ref,
      workspace,
      title: options.title?.trim() || "New thread",
      status: "idle",
      updatedAt: now,
      ...(options.initialModel
        ? {
            config: {
              ...initialConfig,
              provider: options.initialModel.provider,
              modelId: options.initialModel.modelId,
            },
          }
        : initialConfig
          ? { config: initialConfig }
          : {}),
    };
    const record: ManagedFxSession = {
      snapshot,
      companionSessionId: options.companionSessionId,
      listeners: new Set(),
      transcript: [],
      client,
      assistantBuffer: "",
      permissionOptions: new Map(),
      eventQueue: Promise.resolve(),
      loadingHistory: false,
      disposed: false,
    };
    this.records.set(sessionKey(ref), record);
    this.bindClient(record);
    try {
      await this.persist(record);
      if (options.initialModel) {
        await this.setSessionModel(ref, options.initialModel);
      }
      this.scheduleClientClose(record);
      return cloneSnapshot(record.snapshot);
    } catch (error) {
      this.clearClientCloseTimer(record);
      record.disposed = true;
      client.close();
      this.records.delete(sessionKey(ref));
      await this.catalogs.sessions.deleteSession(ref).catch(() => {});
      throw error;
    }
  }

  async openSession(sessionRef: SessionRef): Promise<SessionSnapshot> {
    const existing = this.records.get(sessionKey(sessionRef));
    if (existing) return cloneSnapshot(existing.snapshot);
    const entry = await this.catalogs.sessions.getSession(sessionRef);
    if (!entry || entry.backendId !== "fx")
      throw new Error(`Unknown fx session: ${sessionRef.sessionId}`);
    const workspaceEntry = await this.catalogs.workspaces.getWorkspace(
      sessionRef.workspaceId,
    );
    if (!workspaceEntry)
      throw new Error(`Unknown workspace: ${sessionRef.workspaceId}`);
    const workspace: WorkspaceRef = {
      workspaceId: workspaceEntry.workspaceId,
      path: workspaceEntry.path,
      displayName: workspaceEntry.displayName,
    };
    const record: ManagedFxSession = {
      snapshot: {
        backendId: "fx",
        ref: sessionRef,
        workspace,
        title: entry.title,
        status: "idle",
        updatedAt: entry.updatedAt,
        ...(entry.archivedAt ? { archivedAt: entry.archivedAt } : {}),
        ...(entry.previewSnippet ? { preview: entry.previewSnippet } : {}),
      },
      companionSessionId: entry.companionSessionId,
      listeners: new Set(),
      transcript: [],
      assistantBuffer: "",
      permissionOptions: new Map(),
      eventQueue: Promise.resolve(),
      loadingHistory: false,
      disposed: false,
    };
    this.records.set(sessionKey(sessionRef), record);
    try {
      record.loadingHistory = true;
      const { client, result } = await this.connectAndRequest(
        workspace,
        "session/load",
        {
          sessionId: fromFxSessionId(sessionRef.sessionId),
          cwd: workspace.path,
          mcpServers: [],
        },
        (candidate) => {
          record.client = candidate;
          this.bindClient(record);
        },
      );
      record.client = client;
      record.loadingHistory = false;
      const config = configFromAcpResult(result);
      if (config) record.snapshot = { ...record.snapshot, config };
      this.scheduleClientClose(record);
    } catch (error) {
      this.records.delete(sessionKey(sessionRef));
      record.client?.close();
      throw error;
    }
    await this.emit(
      record,
      event(record, "sessionOpened", {
        snapshot: cloneSnapshot(record.snapshot),
      }),
    );
    return cloneSnapshot(record.snapshot);
  }

  async archiveSession(ref: SessionRef): Promise<void> {
    await this.setArchived(ref, new Date().toISOString());
  }
  async unarchiveSession(ref: SessionRef): Promise<void> {
    await this.setArchived(ref, undefined);
  }

  async sendUserMessage(
    ref: SessionRef,
    input: SessionMessageInput,
  ): Promise<void> {
    const record = await this.record(ref);
    await this.ensureConnected(record);
    this.clearClientCloseTimer(record);
    if (record.snapshot.status === "running")
      throw new Error("fx is already running this session.");
    if (input.attachments?.some((attachment) => attachment.kind === "image")) {
      throw new Error(
        "fx ACP currently supports text and file context, but not image attachments.",
      );
    }
    const text = withFileContext(input.text, input.attachments);
    if (!text.trim()) return;
    const now = new Date().toISOString();
    const runId = randomUUID();
    record.activeRunId = runId;
    record.assistantBuffer = "";
    record.transcript.push({
      kind: "message",
      role: "user",
      text,
      createdAt: now,
      id: randomUUID(),
    });
    trimTranscript(record);
    record.snapshot = {
      ...record.snapshot,
      status: "running",
      updatedAt: now,
      runningRunId: runId,
      preview: text.slice(0, 140),
    };
    await this.persist(record);
    await this.emit(
      record,
      event(record, "sessionUpdated", {
        snapshot: cloneSnapshot(record.snapshot),
      }),
    );
    await this.emit(
      record,
      event(record, "runProgress", {
        runId,
        phase: "generating",
        message: "fx is working…",
      }),
    );
    try {
      await record.client!.request("session/prompt", {
        sessionId: fromFxSessionId(ref.sessionId),
        prompt: [{ type: "text", text }],
      });
      if (record.disposed) return;
      if (record.assistantBuffer) {
        record.transcript.push({
          kind: "message",
          role: "assistant",
          text: record.assistantBuffer,
          createdAt: new Date().toISOString(),
          id: randomUUID(),
        });
        trimTranscript(record);
      }
      record.snapshot = {
        ...record.snapshot,
        status: "idle",
        updatedAt: new Date().toISOString(),
        runningRunId: undefined,
      };
      record.activeRunId = undefined;
      record.assistantBuffer = "";
      record.permissionOptions.clear();
      await this.persist(record);
      await this.emit(
        record,
        event(record, "runCompleted", {
          runId,
          snapshot: cloneSnapshot(record.snapshot),
        }),
      );
      this.scheduleClientClose(record);
    } catch (error) {
      if (record.disposed) throw error;
      if (record.snapshot.status === "failed" && !record.activeRunId) {
        throw error;
      }
      record.snapshot = {
        ...record.snapshot,
        status: "failed",
        updatedAt: new Date().toISOString(),
        runningRunId: undefined,
      };
      record.activeRunId = undefined;
      record.assistantBuffer = "";
      record.permissionOptions.clear();
      await this.persist(record);
      await this.emit(
        record,
        event(record, "runFailed", {
          runId,
          error: { message: errorMessage(error), code: "FX_ACP_PROMPT_FAILED" },
        }),
      );
      this.scheduleClientClose(record);
      throw error;
    }
  }

  async replaceQueuedMessages(
    _ref: SessionRef,
    messages: readonly SessionQueuedMessage[],
  ): Promise<void> {
    if (messages.length)
      throw new Error(
        "fx ACP does not support queued message replacement yet.",
      );
  }

  async cancelCurrentRun(ref: SessionRef): Promise<void> {
    const record = await this.record(ref);
    await this.ensureConnected(record);
    record.client?.notify("session/cancel", {
      sessionId: fromFxSessionId(ref.sessionId),
    });
  }

  async setSessionModel(
    ref: SessionRef,
    selection: SessionModelSelection,
  ): Promise<void> {
    const record = await this.record(ref);
    await this.ensureConnected(record);
    if (!isFxRuntimeProvider(selection.provider)) {
      throw new Error(`fx does not support the ${selection.provider} provider. Use Pi for local models.`);
    }
    await record.client!.request(
      "session/set_config_option",
      {
        sessionId: fromFxSessionId(ref.sessionId),
        configId: "provider",
        value: selection.provider,
      },
      FX_CONTROL_REQUEST_TIMEOUT_MS,
    );
    await record.client!.request(
      "session/set_config_option",
      {
        sessionId: fromFxSessionId(ref.sessionId),
        configId: "model",
        value: selection.modelId,
      },
      FX_CONTROL_REQUEST_TIMEOUT_MS,
    );
    record.snapshot = {
      ...record.snapshot,
      config: {
        ...record.snapshot.config,
        provider: selection.provider,
        modelId: selection.modelId,
      },
    };
    await this.persist(record);
    this.scheduleClientClose(record);
  }

  async setSessionThinkingLevel(
    ref: SessionRef,
    thinkingLevel: string,
  ): Promise<void> {
    void ref;
    void thinkingLevel;
    throw new Error(
      "fx ACP does not currently expose per-session thinking-level changes.",
    );
  }

  async renameSession(ref: SessionRef, title: string): Promise<void> {
    const record = await this.record(ref);
    record.snapshot = {
      ...record.snapshot,
      title: title.trim() || record.snapshot.title,
      updatedAt: new Date().toISOString(),
    };
    await this.persist(record);
    await this.emit(
      record,
      event(record, "sessionUpdated", {
        snapshot: cloneSnapshot(record.snapshot),
      }),
    );
  }

  async compactSession(
    ref: SessionRef,
    customInstructions?: string,
  ): Promise<void> {
    await this.sendUserMessage(ref, {
      text: customInstructions ? `/compact ${customInstructions}` : "/compact",
    });
  }
  async reloadSession(ref: SessionRef): Promise<void> {
    const record = await this.record(ref);
    if (record.snapshot.status === "running") {
      throw new Error("Cannot reload an fx session while it is running.");
    }
    this.clearClientCloseTimer(record);
    if (record.client) {
      record.transcript = [];
      record.loadingHistory = true;
      await record.client
        .request(
          "session/load",
          {
            sessionId: fromFxSessionId(record.snapshot.ref.sessionId),
            cwd: record.snapshot.workspace.path,
            mcpServers: [],
          },
          FX_CONTROL_REQUEST_TIMEOUT_MS,
        )
        .finally(() => {
          record.loadingHistory = false;
        });
    } else {
      await this.ensureConnected(record);
    }
    this.scheduleClientClose(record);
    await this.emit(
      record,
      event(record, "sessionOpened", {
        snapshot: cloneSnapshot(record.snapshot),
      }),
    );
  }
  async getSessionTree(_ref: SessionRef): Promise<SessionTreeSnapshot> {
    return { roots: [], leafId: null };
  }
  async navigateSessionTree(
    _ref: SessionRef,
    _targetId: string,
    _options?: NavigateSessionTreeOptions,
  ): Promise<NavigateSessionTreeResult> {
    throw new Error("fx ACP does not expose session tree navigation.");
  }
  async getSessionCommands(): Promise<readonly []> {
    return [];
  }

  async respondToHostUiRequest(
    ref: SessionRef,
    response: HostUiResponse,
  ): Promise<void> {
    const record = await this.record(ref);
    await this.ensureConnected(record);
    const options = record.permissionOptions.get(response.requestId);
    if (!options)
      throw new Error(`Unknown fx permission request: ${response.requestId}`);
    let optionId: string | undefined;
    if ("value" in response) optionId = options.get(response.value);
    if ("confirmed" in response)
      optionId = response.confirmed
        ? options.get("Allow once")
        : options.get("Reject");
    record.client!.respond(
      Number(response.requestId),
      optionId
        ? { outcome: { outcome: "selected", optionId } }
        : { outcome: { outcome: "cancelled" } },
    );
    record.permissionOptions.delete(response.requestId);
  }

  subscribe(ref: SessionRef, listener: SessionEventListener): Unsubscribe {
    let active = true;
    void this.record(ref).then((record) => {
      if (active) record.listeners.add(listener);
    });
    return () => {
      active = false;
      this.records.get(sessionKey(ref))?.listeners.delete(listener);
    };
  }

  async closeSession(ref: SessionRef): Promise<void> {
    const record = this.records.get(sessionKey(ref));
    if (!record) return;
    record.disposed = true;
    if (record.assistantDeltaTimer) clearTimeout(record.assistantDeltaTimer);
    record.assistantDeltaTimer = undefined;
    record.pendingAssistantDelta = undefined;
    this.clearClientCloseTimer(record);
    record.client?.close();
    record.client = undefined;
    record.listeners.clear();
    this.records.delete(sessionKey(ref));
  }

  async getTranscript(ref: SessionRef): Promise<SessionTranscriptMessage[]> {
    const record = await this.record(ref);
    return record.transcript.map((message) => ({ ...message }));
  }

  private async connectAndRequest(
    workspace: WorkspaceRef,
    method: "session/new" | "session/load",
    params: JsonObject,
    onInitialized?: (client: FxAcpClient) => void,
  ): Promise<{ client: FxAcpClient; result: JsonObject }> {
    const binaries = await resolveFxBinaryCandidates({
      bundledRoot: this.bundledRoot,
      binaryPath: this.binaryPath,
    });
    if (!binaries.length)
      throw new Error(
        "fx runtime is unavailable. Reinstall the app to restore the bundled runtime.",
      );
    let lastError: unknown;
    for (const binary of binaries) {
      const client = new FxAcpClient(binary, workspace.path);
      try {
        await client.initialize();
        onInitialized?.(client);
        const result = await client.request(
          method,
          params,
          FX_CONTROL_REQUEST_TIMEOUT_MS,
        );
        return { client, result };
      } catch (error) {
        lastError = error;
        client.close();
      }
    }
    throw new Error(
      `No compatible fx ACP runtime could complete ${method}: ${errorMessage(lastError)}`,
    );
  }

  private async inspectCli(
    workspacePath: string,
  ): Promise<{ readonly binary: string; readonly status: FxAuthStatus } | undefined> {
    const binaries = await resolveFxBinaryCandidates({
      bundledRoot: this.bundledRoot,
      binaryPath: this.binaryPath,
    });
    for (const binary of binaries) {
      const status = await inspectFxCliBinary(binary, workspacePath);
      if (status) return { binary, status };
    }
    return undefined;
  }

  private bindClient(record: ManagedFxSession): void {
    const client = record.client!;
    client.onMessage = (message) => this.handleMessage(record, message);
    client.onExit = (error) => {
      if (record.client === client) record.client = undefined;
      if (!record.disposed && record.snapshot.status === "running") {
        const runId = record.activeRunId;
        record.snapshot = {
          ...record.snapshot,
          status: "failed",
          runningRunId: undefined,
          updatedAt: new Date().toISOString(),
        };
        record.activeRunId = undefined;
        record.assistantBuffer = "";
        record.permissionOptions.clear();
        void this.persist(record)
          .then(() =>
            this.emit(
              record,
              event(record, "runFailed", {
                runId,
                error: { message: error, code: "FX_ACP_EXIT" },
              }),
            ),
          )
          .catch(() => {});
      }
    };
  }

  private handleMessage(record: ManagedFxSession, message: JsonObject): void {
    if (message.method === "session/update") {
      const params = asObject(message.params);
      const update = asObject(params?.update);
      if (!update) return;
      const kind = update?.sessionUpdate;
      if (kind === "agent_message_chunk") {
        const text = stringField(asObject(update.content), "text") ?? "";
        if (record.activeRunId) {
          record.assistantBuffer += text;
          void this.emit(
            record,
            event(record, "assistantDelta", {
              runId: record.activeRunId,
              text,
            }),
          );
        } else {
          appendHistoryChunk(record, "assistant", text);
        }
      } else if (kind === "user_message_chunk") {
        const text = stringField(asObject(update.content), "text");
        if (text && !record.activeRunId)
          appendHistoryChunk(record, "user", text);
      } else if (kind === "tool_call") {
        if (record.loadingHistory) return;
        void this.emit(
          record,
          event(record, "toolStarted", {
            runId: record.activeRunId,
            callId: stringField(update, "toolCallId") ?? randomUUID(),
            toolName:
              stringField(update, "title") ??
              stringField(update, "kind") ??
              "fx tool",
            input: update.rawInput,
          }),
        );
      } else if (kind === "tool_call_update") {
        if (record.loadingHistory) return;
        const status = stringField(update, "status");
        const callId = stringField(update, "toolCallId") ?? "fx-tool";
        const output = extractAcpContent(update.content);
        if (status === "completed" || status === "failed") {
          void this.emit(
            record,
            event(record, "toolFinished", {
              runId: record.activeRunId,
              callId,
              success: status === "completed",
              output,
            }),
          );
        } else {
          void this.emit(
            record,
            event(record, "toolUpdated", {
              runId: record.activeRunId,
              callId,
              text: output,
            }),
          );
        }
      }
      return;
    }
    if (
      message.method === "session/request_permission" &&
      message.id !== undefined &&
      !record.loadingHistory
    ) {
      const params = asObject(message.params);
      const tool = asObject(params?.toolCall);
      const options = Array.isArray(params?.options)
        ? (params.options.map(asObject).filter(Boolean) as JsonObject[])
        : [];
      const requestId = String(message.id);
      const labels = options.map(
        (option) =>
          stringField(option, "name") ??
          stringField(option, "optionId") ??
          "Option",
      );
      record.permissionOptions.set(
        requestId,
        new Map(
          options.map((option, index) => [
            labels[index]!,
            stringField(option, "optionId") ?? "reject_once",
          ]),
        ),
      );
      void this.emit(
        record,
        event(record, "hostUiRequest", {
          runId: record.activeRunId,
          request: {
            kind: "select",
            requestId,
            title: stringField(tool, "title") ?? "fx requests permission",
            options: labels,
          },
        }),
      );
    }
  }

  private async record(ref: SessionRef): Promise<ManagedFxSession> {
    return (
      this.records.get(sessionKey(ref)) ??
      (await this.openSession(ref), this.records.get(sessionKey(ref))!)
    );
  }

  private async ensureConnected(record: ManagedFxSession): Promise<void> {
    if (record.disposed) throw new Error("fx session is closed.");
    if (record.client) return;
    try {
      record.transcript = [];
      record.loadingHistory = true;
      const { client, result } = await this.connectAndRequest(
        record.snapshot.workspace,
        "session/load",
        {
          sessionId: fromFxSessionId(record.snapshot.ref.sessionId),
          cwd: record.snapshot.workspace.path,
          mcpServers: [],
        },
        (candidate) => {
          record.client = candidate;
          this.bindClient(record);
        },
      );
      record.client = client;
      record.loadingHistory = false;
      const config = configFromAcpResult(result);
      if (config) record.snapshot = { ...record.snapshot, config };
    } catch (error) {
      record.loadingHistory = false;
      record.client?.close();
      record.client = undefined;
      throw error;
    }
  }

  private scheduleClientClose(record: ManagedFxSession): void {
    this.clearClientCloseTimer(record);
    record.idleTimer = setTimeout(() => {
      record.client?.close();
      record.client = undefined;
      record.idleTimer = undefined;
    }, FX_IDLE_CLIENT_TIMEOUT_MS);
    record.idleTimer.unref();
  }

  private clearClientCloseTimer(record: ManagedFxSession): void {
    if (record.idleTimer) clearTimeout(record.idleTimer);
    record.idleTimer = undefined;
  }

  private async setArchived(
    ref: SessionRef,
    archivedAt: string | undefined,
  ): Promise<void> {
    const record = await this.record(ref);
    record.snapshot = archivedAt
      ? { ...record.snapshot, archivedAt }
      : withoutArchivedAt(record.snapshot);
    await this.persist(record);
    if (archivedAt && record.snapshot.status !== "running") {
      this.clearClientCloseTimer(record);
      record.client?.close();
      record.client = undefined;
    }
  }

  private async persist(record: ManagedFxSession): Promise<void> {
    if (record.disposed) return;
    const snapshot = record.snapshot;
    await this.catalogs.sessions.upsertSession({
      backendId: "fx",
      companionSessionId: record.companionSessionId,
      sessionRef: snapshot.ref,
      workspaceId: snapshot.ref.workspaceId,
      title: snapshot.title,
      updatedAt: snapshot.updatedAt,
      status: snapshot.status,
      ...(snapshot.archivedAt ? { archivedAt: snapshot.archivedAt } : {}),
      ...(snapshot.preview ? { previewSnippet: snapshot.preview } : {}),
    });
  }

  private async emit(
    record: ManagedFxSession,
    driverEvent: SessionDriverEvent,
  ): Promise<void> {
    if (driverEvent.type === "assistantDelta") {
      const pending = record.pendingAssistantDelta;
      if (pending && pending.runId !== driverEvent.runId) {
        this.flushAssistantDelta(record);
      }
      record.pendingAssistantDelta =
        pending && pending.runId === driverEvent.runId
          ? { ...pending, text: pending.text + driverEvent.text }
          : driverEvent;
      if (!record.assistantDeltaTimer) {
        record.assistantDeltaTimer = setTimeout(() => {
          record.assistantDeltaTimer = undefined;
          this.flushAssistantDelta(record);
        }, FX_ASSISTANT_DELTA_BATCH_MS);
      }
      return;
    }

    this.flushAssistantDelta(record);
    await this.enqueueEvent(record, driverEvent);
  }

  private flushAssistantDelta(record: ManagedFxSession): void {
    const pending = record.pendingAssistantDelta;
    if (!pending) return;
    record.pendingAssistantDelta = undefined;
    if (record.assistantDeltaTimer) clearTimeout(record.assistantDeltaTimer);
    record.assistantDeltaTimer = undefined;
    void this.enqueueEvent(record, pending);
  }

  private async enqueueEvent(
    record: ManagedFxSession,
    driverEvent: SessionDriverEvent,
  ): Promise<void> {
    record.eventQueue = record.eventQueue
      .catch(() => {})
      .then(async () => {
        for (const listener of [...record.listeners]) {
          try {
            await listener(driverEvent);
          } catch {
            // One renderer listener must not permanently block later ACP events.
          }
        }
      });
    await record.eventQueue;
  }
}

interface ResolveFxBinaryOptions {
  readonly bundledRoot?: string;
  readonly binaryPath?: string;
}

export async function resolveFxBinary(
  options: ResolveFxBinaryOptions = {},
): Promise<string | undefined> {
  return (await resolveFxBinaryCandidates(options))[0];
}

async function resolveFxBinaryCandidates(
  options: ResolveFxBinaryOptions = {},
): Promise<string[]> {
  const explicit = options.binaryPath ?? process.env.PI_FX_BINARY;
  const pathCandidates = (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .map((dir) => join(dir, executableName()));
  const homeCandidates = [
    join(homedir(), ".fx", "bin", executableName()),
    join(homedir(), ".local", "bin", executableName()),
  ];
  const systemCandidates =
    process.platform === "win32"
      ? pathCandidates
      : [
          ...pathCandidates,
          ...homeCandidates,
          `/opt/homebrew/bin/${executableName()}`,
          `/usr/local/bin/${executableName()}`,
        ];
  const bundledCandidates = options.bundledRoot
    ? [
        join(
          options.bundledRoot,
          `${process.platform}-${process.arch}`,
          executableName(),
        ),
      ]
    : [];
  const resolved: string[] = [];
  for (const candidate of [
    ...new Set([explicit, ...systemCandidates, ...bundledCandidates]),
  ]) {
    if (!candidate) continue;
    try {
      await access(candidate, constants.X_OK);
      resolved.push(candidate);
    } catch {
      /* try the next candidate */
    }
  }
  return resolved;
}

class FxAcpClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    number,
    { resolve: (value: JsonObject) => void; reject: (error: Error) => void }
  >();
  private nextId = 1;
  private buffer = "";
  private stderr = "";
  private closed = false;
  onMessage?: (message: JsonObject) => void;
  onExit?: (error: string) => void;

  constructor(binary: string, cwd: string) {
    this.child = spawn(
      binary,
      ["--context-limit", "skill_description_bytes=4096", "acp"],
      {
        cwd,
        env: { ...process.env, FX_AUTO_UPGRADE: "0", FX_SOUND: "0" },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.consume(chunk));
    this.child.stderr.on("data", (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-8000);
    });
    this.child.on("exit", (code, signal) => {
      const reason = `fx ACP exited (${signal ?? code ?? "unknown"})${this.stderr.trim() ? `: ${this.stderr.trim()}` : ""}`;
      for (const pending of this.pending.values())
        pending.reject(new Error(reason));
      this.pending.clear();
      if (!this.closed) this.onExit?.(reason);
    });
    this.child.on("error", (error) => {
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
  }

  async initialize(): Promise<void> {
    await this.request(
      "initialize",
      { protocolVersion: 1, clientCapabilities: {} },
      10_000,
    );
  }

  request(
    method: string,
    params: JsonObject,
    timeoutMs = 0,
  ): Promise<JsonObject> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      const clearTimer = () => {
        if (timer) clearTimeout(timer);
      };
      this.pending.set(id, {
        resolve: (value) => {
          clearTimer();
          resolve(value);
        },
        reject: (error) => {
          clearTimer();
          reject(error);
        },
      });
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          if (this.pending.delete(id)) {
            reject(new Error(`fx ACP ${method} timed out`));
          }
        }, timeoutMs);
        timer.unref();
      }
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: JsonObject): void {
    this.write({ jsonrpc: "2.0", method, params });
  }
  respond(id: number, result: JsonObject): void {
    this.write({ jsonrpc: "2.0", id, result });
  }
  close(): void {
    this.closed = true;
    if (!this.child.killed) this.child.kill();
  }

  private write(message: JsonObject): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }
  private consume(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const index = this.buffer.indexOf("\n");
      if (index < 0) break;
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message: JsonObject;
      try {
        message = JSON.parse(line) as JsonObject;
      } catch {
        continue;
      }
      if (
        typeof message.id === "number" &&
        ("result" in message || "error" in message)
      ) {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        const rpcError = asObject(message.error);
        if (rpcError)
          pending.reject(
            new Error(
              stringField(rpcError, "message") ?? "fx ACP request failed",
            ),
          );
        else pending.resolve(asObject(message.result) ?? {});
      } else {
        this.onMessage?.(message);
      }
    }
  }
}

function event<T extends SessionDriverEvent["type"]>(
  record: ManagedFxSession,
  type: T,
  fields: JsonObject,
): Extract<SessionDriverEvent, { type: T }> {
  return {
    type,
    sessionRef: record.snapshot.ref,
    timestamp: new Date().toISOString(),
    ...fields,
  } as Extract<SessionDriverEvent, { type: T }>;
}
function toFxSessionId(id: string): string {
  return id.startsWith(FX_SESSION_PREFIX) ? id : `${FX_SESSION_PREFIX}${id}`;
}
function fromFxSessionId(id: string): string {
  return id.startsWith(FX_SESSION_PREFIX)
    ? id.slice(FX_SESSION_PREFIX.length)
    : id;
}
export function isFxSession(ref: SessionRef): boolean {
  return ref.sessionId.startsWith(FX_SESSION_PREFIX);
}
function executableName(): string {
  return process.platform === "win32" ? "fx.exe" : "fx";
}
function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}
function stringField(
  value: JsonObject | undefined,
  key: string,
): string | undefined {
  const field = value?.[key];
  return typeof field === "string" ? field : undefined;
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function cloneSnapshot(snapshot: SessionSnapshot): SessionSnapshot {
  return structuredClone(snapshot);
}
function withoutArchivedAt(snapshot: SessionSnapshot): SessionSnapshot {
  const { archivedAt: _, ...next } = snapshot;
  return next;
}
function withFileContext(
  text: string,
  attachments: SessionMessageInput["attachments"],
): string {
  const files =
    attachments?.filter((attachment) => attachment.kind === "file") ?? [];
  if (!files.length) return text;
  return `${files.map((file) => `[Attached file: ${file.fsPath}]`).join("\n")}\n${text}`.trim();
}
function extractAcpContent(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  return (
    value
      .map(
        (item) => stringField(asObject(asObject(item)?.content), "text") ?? "",
      )
      .filter(Boolean)
      .join("\n") || undefined
  );
}

async function inspectFxCliBinary(
  binary: string,
  workspacePath: string,
): Promise<FxAuthStatus | undefined> {
  try {
    const result = await runFxCli(binary, ["status", "--json"], workspacePath, FX_STATUS_TIMEOUT_MS);
    const status = parseFxAuthStatus(result.stdout);
    try {
      const models = await runFxCli(binary, ["models", "--json"], workspacePath, FX_STATUS_TIMEOUT_MS);
      return withFxModels(status, models.stdout);
    } catch {
      return { ...status, message: "fx is connected, but its model catalog is currently unavailable." };
    }
  } catch {
    return undefined;
  }
}

function runFxCli(
  binary: string,
  args: readonly string[],
  workspacePath: string,
  timeoutMs: number,
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [...args], {
      cwd: workspacePath,
      env: { ...process.env, FX_AUTO_UPGRADE: "0", FX_SOUND: "0" },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const capture = (target: Buffer[], chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > FX_CLI_OUTPUT_LIMIT) {
        child.kill();
        finish(() => reject(new Error("fx command produced too much output.")));
        return;
      }
      target.push(chunk);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error(`fx ${args[0] ?? "command"} timed out.`)));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => capture(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => capture(stderr, chunk));
    child.on("error", (error) => finish(() => reject(error)));
    child.on("exit", (code, signal) => {
      finish(() => {
        if (code === 0) {
          resolve({
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: Buffer.concat(stderr).toString("utf8"),
          });
          return;
        }
        reject(new Error(
          signal
            ? `fx ${args[0] ?? "command"} was interrupted (${signal}).`
            : `fx ${args[0] ?? "command"} failed with exit code ${code ?? "unknown"}.`,
        ));
      });
    });
    child.stdin.end();
  });
}

export async function readFxDefaultModelSelection(
  settingsPath = process.env.PI_FX_SETTINGS_PATH ?? join(homedir(), ".fx", "settings.json"),
): Promise<SessionModelSelection | undefined> {
  try {
    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as JsonObject;
    const provider = stringField(settings, "provider");
    if (!provider) return undefined;
    const models = asObject(settings.models);
    const modelId = stringField(models, provider)
      ?? stringField(settings, `${provider}_model`)
      ?? stringField(settings, "model");
    return modelId ? { provider, modelId } : undefined;
  } catch {
    return undefined;
  }
}

function configFromAcpResult(result: JsonObject): SessionSnapshot["config"] {
  if (!Array.isArray(result.configOptions)) return undefined;
  const values = new Map(
    result.configOptions
      .map(asObject)
      .filter(Boolean)
      .map((option) => [
        stringField(option, "id"),
        stringField(option, "currentValue"),
      ]),
  );
  const provider = values.get("provider");
  const modelId = values.get("model");
  return provider || modelId
    ? { ...(provider ? { provider } : {}), ...(modelId ? { modelId } : {}) }
    : undefined;
}
function appendHistoryChunk(
  record: ManagedFxSession,
  role: "user" | "assistant",
  text: string,
): void {
  const last = record.transcript.at(-1);
  if (last?.role === role) {
    record.transcript[record.transcript.length - 1] = {
      ...last,
      text: `${last.text}${text}`,
    };
  } else {
    record.transcript.push({
      kind: "message",
      role,
      text,
      createdAt: new Date().toISOString(),
      id: randomUUID(),
    });
  }
  trimTranscript(record);
}

function trimTranscript(record: ManagedFxSession): void {
  if (record.transcript.length > FX_TRANSCRIPT_MESSAGE_LIMIT) {
    record.transcript.splice(
      0,
      record.transcript.length - FX_TRANSCRIPT_MESSAGE_LIMIT,
    );
  }
}
