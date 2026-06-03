import type { ReactNode } from "react";
import type { RuntimeSettingsSnapshot, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import { ProviderIcon, providerLoginIconUrl } from "./provider-icons";
import { ProviderBalance } from "./provider-balance";

export type SettingsSection = "appearance" | "general" | "providers" | "models" | "notifications";

export const THINKING_LEVELS: NonNullable<RuntimeSettingsSnapshot["defaultThinkingLevel"]>[] = [
  "low", "medium", "high", "xhigh",
];

export function settingsPill(active: boolean): string {
  return `settings-pill${active ? " settings-pill--active" : ""}`;
}

export function labelForThinking(level: NonNullable<RuntimeSettingsSnapshot["defaultThinkingLevel"]>): string {
  if (level === "xhigh") return "Extra High";
  return level.charAt(0).toUpperCase() + level.slice(1);
}

export function sectionTitle(t: (key: string) => string, section: SettingsSection): string {
  const map: Record<SettingsSection, string> = {
    appearance: "settings.appearance", providers: "settings.providers",
    models: "settings.models", notifications: "settings.notifications", general: "settings.general",
  };
  return t(map[section]);
}

export function sectionDescription(t: (key: string) => string, section: SettingsSection, workspaceName: string): string {
  if (section === "providers") return t("settings.providers.description", { workspace: workspaceName });
  const map: Record<SettingsSection, string> = {
    appearance: "settings.appearance.description", providers: "settings.providers.description",
    models: "settings.models.description", notifications: "settings.notifications.description",
    general: "settings.general.description",
  };
  return t(map[section]);
}

export function filterProviders(providers: readonly RuntimeSnapshot["providers"][number][], query: string) {
  const n = query.trim().toLowerCase();
  if (!n) return providers;
  return providers.filter((p) => [p.id, p.name, p.authType].some((v) => v.toLowerCase().includes(n)));
}

export function filterModels(models: readonly RuntimeSnapshot["models"][number][], query: string) {
  const n = query.trim().toLowerCase();
  if (!n) return models;
  return models.filter((m) => [m.providerId, m.providerName, m.modelId, m.label].some((v) => v.toLowerCase().includes(n)));
}

export function SettingsGroup({ title, description, children }: { readonly title?: string; readonly description?: string; readonly children: ReactNode }) {
  return <div className="settings-section">
    {(title || description) ? (
      <div className="settings-section__header">
        {title ? <h3 className="settings-section__title">{title}</h3> : null}
        {description ? <span className="settings-section__description">{description}</span> : null}
      </div>
    ) : null}
    <div className="settings-group">{children}</div>
  </div>;
}

export function SettingsRow({ title, description, children }: { readonly title: string; readonly description?: string; readonly children?: ReactNode }) {
  return <div className="settings-row">
    <div className="settings-row__label">
      <div className="settings-row__title">{title}</div>
      {description ? <div className="settings-row__description">{description}</div> : null}
    </div>
    {children ? <div className="settings-row__control">{children}</div> : null}
  </div>;
}

export function SettingsInfoRow({ label, value }: { readonly label: string; readonly value: string }) {
  return <div className="settings-row">
    <div className="settings-row__label"><div className="settings-row__title">{label}</div></div>
    <div className="settings-row__control"><span className="settings-row__value">{value}</span></div>
  </div>;
}

export function ProviderRow({ provider, onLoginProvider, onLogoutProvider, onConfigureApiKey, t: _t }: {
  readonly provider: RuntimeSnapshot["providers"][number];
  readonly onLoginProvider: (providerId: string) => void;
  readonly onLogoutProvider: (providerId: string) => void;
  readonly onConfigureApiKey: (provider: RuntimeSnapshot["providers"][number]) => void;
  readonly t?: (key: string) => string;
}) {
  const _ = _t ?? ((s: string) => s);
  const action = resolveProviderAction(provider, onLoginProvider, onLogoutProvider, onConfigureApiKey, _);
  const loginIconUrl = provider.oauthSupported ? providerLoginIconUrl(provider.id) : undefined;
  return <div className="settings-row">
    <div className="settings-row__label" style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <ProviderIcon provider={provider} size={28} />
      <div>
        <div className="settings-row__title">{provider.name}</div>
        <div className="settings-row__description">
          {describeProviderStatus(provider, _)}
          <ProviderBalance providerId={provider.id} hasAuth={provider.hasAuth} />
        </div>
      </div>
    </div>
    <div className="settings-row__control" style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button className="button button--secondary provider-login-button" disabled={action.disabled} type="button" onClick={action.onClick}>
        <span>{action.label}</span>
        {loginIconUrl ? <img className="provider-login-button__icon" src={loginIconUrl} alt="" aria-hidden="true" /> : null}
      </button>
    </div>
  </div>;
}

export function ProviderExternalConfigDialog({ provider, onClose }: { provider: RuntimeSnapshot["providers"][number]; onClose: () => void }) {
  const envVar = providerNameToEnvVar(provider.id);
  return (
    <div className="extension-dialog-backdrop">
      <div className="extension-dialog">
        <div className="extension-dialog__title">External Configuration — {provider.name}</div>
        <p className="extension-dialog__body">
          {provider.name} is configured outside the app. To connect, set your API key as an environment variable:
        </p>
        <div className="install-box" style={{ background: "#161b22", padding: 12, borderRadius: 6, marginBottom: 12 }}>
          <code style={{ fontSize: 13, color: "#7ee787" }}>export {envVar}="sk-your-key-here"</code>
        </div>
        <p className="extension-dialog__body" style={{ fontSize: 12, opacity: 0.7 }}>
          Add this to ~/.zshrc or ~/.bashrc for permanent configuration. Restart Pi-Deepseek after setting.
        </p>
        <div className="extension-dialog__actions">
          <button className="button button--secondary" type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function providerNameToEnvVar(id: string): string {
  const map: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    google: "GOOGLE_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    groq: "GROQ_API_KEY",
    mistral: "MISTRAL_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    cerebras: "CEREBRAS_API_KEY",
    xai: "XAI_API_KEY",
    zai: "ZAI_API_KEY",
    huggingface: "HF_TOKEN",
  };
  return map[id] ?? `${id.toUpperCase().replace(/-/g, "_")}_API_KEY`;
}

function _(s: string) { return s; }
function describeProviderStatus(provider: RuntimeSnapshot["providers"][number], _t: (key: string) => string = _): string {
  const t = _t;
  switch (provider.authSource) {
    case "oauth": return t("settings.providers.oauthConnected");
    case "auth_file": return t("settings.providers.apiKeyConnected");
    case "env": return t("settings.providers.envConnected");
    case "external": return provider.hasAuth ? t("settings.providers.externalConnected") : t("settings.providers.configureExternally");
    default:
      if (provider.oauthSupported) return t("settings.providers.oauthAvailable");
      if (provider.apiKeySetupSupported) return t("settings.providers.needsApiKey");
      return provider.authType === "api_key" ? t("settings.providers.apiKeyAvailable") : t("settings.providers.builtIn");
  }
}

function resolveProviderAction(
  provider: RuntimeSnapshot["providers"][number],
  onLoginProvider: (providerId: string) => void,
  onLogoutProvider: (providerId: string) => void,
  onConfigureApiKey: (provider: RuntimeSnapshot["providers"][number]) => void,
  t: (key: string) => string = _,
) {
  if (provider.authSource === "oauth") return { disabled: false, label: t("settings.providers.logout"), onClick: () => onLogoutProvider(provider.id) };
  if (provider.oauthSupported && provider.authSource === "none") return { disabled: false, label: t("settings.providers.login"), onClick: () => onLoginProvider(provider.id) };
  if (provider.apiKeySetupSupported && (provider.authSource === "none" || provider.authSource === "auth_file"))
    return { disabled: false, label: provider.authSource === "auth_file" ? t("settings.providers.manage") : t("settings.providers.setApiKey"), onClick: () => onConfigureApiKey(provider) };
  // External/env providers: show help instead of disabled button
  if (provider.authSource === "env" || provider.authSource === "external")
    return { disabled: false, label: t("settings.providers.configure"), onClick: () => onConfigureApiKey(provider) };
  return { disabled: true, label: t("settings.providers.configureExternally") };
}
