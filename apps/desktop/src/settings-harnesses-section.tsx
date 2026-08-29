import { useEffect, useRef, useState } from "react";
import type { RuntimeSettingsSnapshot, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { DshWebStatus } from "./ipc";
import {
  FX_AUTH_PROVIDERS,
  type FxAuthProvider,
  type FxAuthStatus,
} from "./fx-auth";
import { useT } from "./i18n";
import {
  labelForThinking,
  settingsPill,
  SettingsGroup,
  SettingsInfoRow,
  SettingsRow,
  THINKING_LEVELS,
} from "./settings-utils";

interface SettingsHarnessesSectionProps {
  readonly workspaceId?: string;
  readonly runtime?: RuntimeSnapshot;
  readonly fxAvailable: boolean;
  readonly fxDefaultModel?: { readonly provider: string; readonly modelId: string };
  readonly onSetDefaultModel: (provider: string, modelId: string) => void;
  readonly onSetThinkingLevel: (thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"]) => void;
}

export function SettingsHarnessesSection({
  workspaceId,
  runtime,
  fxAvailable,
  fxDefaultModel,
  onSetDefaultModel,
  onSetThinkingLevel,
}: SettingsHarnessesSectionProps) {
  const t = useT();
  const api = window.piApp;
  const mountedRef = useRef(true);
  const [dshStatus, setDshStatus] = useState<DshWebStatus>();
  const [dshPending, setDshPending] = useState(false);
  const [fxStatus, setFxStatus] = useState<FxAuthStatus>();
  const [fxPendingProvider, setFxPendingProvider] = useState<FxAuthProvider>();
  const [fxError, setFxError] = useState<string>();
  const availableModels = runtime?.models.filter((model) => model.available) ?? [];
  const defaultModel = runtime?.settings.defaultProvider && runtime.settings.defaultModelId
    ? `${runtime.settings.defaultProvider}:${runtime.settings.defaultModelId}`
    : "";
  const defaultModelAvailable = availableModels.some(
    (model) => `${model.providerId}:${model.modelId}` === defaultModel,
  );

  useEffect(() => {
    mountedRef.current = true;
    void api?.getDshWebStatus()
      .then((status) => {
        if (mountedRef.current) setDshStatus(status);
      })
      .catch((error) => {
        if (mountedRef.current) {
          setDshStatus({ state: "error", message: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      mountedRef.current = false;
    };
  }, [api]);

  useEffect(() => {
    if (!api || !workspaceId || !fxAvailable) return;
    let active = true;
    void api.getFxAuthStatus(workspaceId)
      .then((status) => {
        if (active) setFxStatus(status);
      })
      .catch((error) => {
        if (active) setFxError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, [api, fxAvailable, workspaceId]);

  const runFxProviderAction = async (provider: FxAuthProvider, action: "login" | "select") => {
    if (!api || !workspaceId) return;
    setFxPendingProvider(provider);
    setFxError(undefined);
    try {
      const result = action === "login"
        ? await api.loginFxProvider(workspaceId, provider)
        : await api.selectFxProvider(workspaceId, provider);
      if (mountedRef.current) setFxStatus(result);
    } catch (error) {
      if (mountedRef.current) setFxError(error instanceof Error ? error.message : String(error));
    } finally {
      if (mountedRef.current) setFxPendingProvider(undefined);
    }
  };

  const connectDeepSeekHarness = async () => {
    if (!api) return;
    setDshPending(true);
    try {
      const status = await api.startDshWeb();
      if (mountedRef.current) setDshStatus(status);
    } catch (error) {
      if (mountedRef.current) {
        setDshStatus({ state: "error", message: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      if (mountedRef.current) setDshPending(false);
    }
  };

  return (
    <div className="harness-settings" data-testid="harness-settings">
      <SettingsGroup title="Pi" description={t("settings.harnesses.piDesc")}>
        <SettingsRow title={t("settings.models.defaultModel")} description={t("settings.harnesses.piModelDesc")}>
          <select
            aria-label="Pi default model"
            className="settings-select"
            disabled={availableModels.length === 0}
            value={defaultModelAvailable ? defaultModel : ""}
            onChange={(event) => {
              const [provider, ...modelParts] = event.target.value.split(":");
              const modelId = modelParts.join(":");
              if (provider && modelId) onSetDefaultModel(provider, modelId);
            }}
          >
            <option value="">{t("settings.models.chooseModel")}</option>
            {availableModels.map((model) => (
              <option key={`${model.providerId}:${model.modelId}`} value={`${model.providerId}:${model.modelId}`}>
                {model.providerName} · {model.label}
              </option>
            ))}
          </select>
        </SettingsRow>
        <SettingsRow title={t("settings.models.reasoning")} description={t("settings.harnesses.piReasoningDesc")}>
          <div className="settings-pill-row">
            {THINKING_LEVELS.map((level) => (
              <button
                aria-pressed={runtime?.settings.defaultThinkingLevel === level}
                className={settingsPill(runtime?.settings.defaultThinkingLevel === level)}
                key={level}
                type="button"
                onClick={() => onSetThinkingLevel(level)}
              >
                {labelForThinking(level)}
              </button>
            ))}
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="fx" description={t("settings.harnesses.fxDesc")}>
        <SettingsInfoRow label={t("settings.harnesses.runtime")} value={fxAvailable ? t("settings.harnesses.available") : t("settings.harnesses.unavailable")} />
        {!fxAvailable ? (
          <p className="settings-help fx-provider-help">
            {t(api?.platform === "win32"
              ? "settings.harnesses.fxUnavailableWindows"
              : "settings.harnesses.fxUnavailableRuntime")}
          </p>
        ) : null}
        <SettingsInfoRow label={t("settings.harnesses.provider")} value={fxDefaultModel?.provider ?? t("settings.harnesses.useFxDefault")} />
        <SettingsInfoRow label={t("settings.models.defaultModel")} value={fxDefaultModel?.modelId ?? t("settings.harnesses.notConfigured")} />
        <div className="fx-provider-grid" aria-label={t("settings.harnesses.fxAccounts")}>
          {FX_AUTH_PROVIDERS.map((provider) => {
            const connected = fxStatus?.connectedProviders.includes(provider) ?? false;
            const connectionKnown = fxStatus?.connectionsKnown ?? true;
            const active = fxStatus?.activeProvider === provider;
            const pending = fxPendingProvider === provider;
            return (
              <article className={`fx-provider-card${active ? " fx-provider-card--active" : ""}`} key={provider}>
                <div className="fx-provider-card__identity">
                  <span className={`fx-provider-card__mark fx-provider-card__mark--${provider}`} aria-hidden="true">
                    {provider === "vercel" ? "▲" : provider === "codex" ? "◎" : "𝕏"}
                  </span>
                  <span>
                    <strong>{fxProviderLabel(provider)}</strong>
                    <small>{fxProviderDescription(provider)}</small>
                  </span>
                </div>
                <div className="fx-provider-card__action">
                  <span className={`fx-provider-card__status${connected ? " fx-provider-card__status--connected" : ""}`}>
                    {active
                      ? t("settings.harnesses.active")
                      : connected
                        ? t("settings.harnesses.connected")
                        : connectionKnown
                          ? t("settings.harnesses.notConnected")
                          : t("settings.harnesses.connectionUnknown")}
                  </span>
                  {active ? null : (
                    <button
                      className="button button--secondary"
                      disabled={!workspaceId || !fxAvailable || Boolean(fxPendingProvider)}
                      type="button"
                      onClick={() => void runFxProviderAction(provider, connected ? "select" : "login")}
                    >
                      {pending
                        ? t("settings.harnesses.connecting")
                        : connected
                          ? t("settings.harnesses.useProvider")
                          : t("settings.harnesses.connectBrowser")}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        {fxAvailable ? (
          <p className="settings-help fx-provider-help">
            {t("settings.harnesses.fxLoginHelp")}
          </p>
        ) : null}
        {fxStatus?.message ? <p className="settings-warning">{fxStatus.message}</p> : null}
        {fxError ? <p className="settings-inline-error" role="alert">{fxError}</p> : null}
      </SettingsGroup>

      <SettingsGroup title="DeepSeek Harness" description={t("settings.harnesses.deepseekDesc")}>
        <SettingsInfoRow label={t("settings.harnesses.serviceStatus")} value={describeDshStatus(dshStatus, t)} />
        <SettingsInfoRow label={t("settings.harnesses.serviceUrl")} value={dshStatus?.state === "running" ? dshStatus.url : "http://127.0.0.1:3080/"} />
        <SettingsRow title={t("settings.harnesses.connection")} description={dshStatus?.state === "error" ? dshStatus.message : t("settings.harnesses.connectionDesc")}>
          <button
            className="button button--secondary"
            disabled={dshPending}
            type="button"
            onClick={() => void connectDeepSeekHarness()}
          >
            {dshPending ? t("settings.harnesses.connecting") : dshStatus?.state === "running" ? t("settings.harnesses.refresh") : t("settings.harnesses.connect")}
          </button>
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}

function fxProviderLabel(provider: FxAuthProvider): string {
  if (provider === "vercel") return "Vercel AI Gateway";
  if (provider === "codex") return "OpenAI Codex";
  return "xAI Grok";
}

function fxProviderDescription(provider: FxAuthProvider): string {
  if (provider === "vercel") return "Vercel account · browser OAuth";
  if (provider === "codex") return "ChatGPT subscription · browser OAuth";
  return "xAI subscription · browser OAuth";
}

function describeDshStatus(status: DshWebStatus | undefined, t: (key: string) => string): string {
  if (!status) return t("settings.harnesses.checking");
  if (status.state === "running") return t("settings.harnesses.connected");
  if (status.state === "starting") return t("settings.harnesses.connecting");
  if (status.state === "error") return t("settings.harnesses.unavailable");
  return t("settings.harnesses.notConnected");
}
