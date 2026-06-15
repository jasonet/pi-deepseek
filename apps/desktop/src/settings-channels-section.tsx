import { useMemo, useState } from "react";
import type { ImAgentProfile, ImChannel, ImCredential, ImProvider, ImSettings, SaveImChannelInput } from "./desktop-state";
import { SettingsGroup, SettingsRow } from "./settings-utils";

const PROVIDERS: readonly { id: ImProvider; label: string; fields: readonly { key: string; label: string; secret?: boolean }[] }[] = [
  { id: "feishu", label: "飞书", fields: [{ key: "domain", label: "Domain" }, { key: "appId", label: "App ID" }, { key: "appSecret", label: "App Secret", secret: true }] },
  { id: "weixin", label: "微信", fields: [{ key: "accountId", label: "Account ID" }, { key: "sessionKey", label: "Session Key", secret: true }] },
  { id: "telegram", label: "Telegram", fields: [{ key: "botToken", label: "Bot token", secret: true }] },
  { id: "discord", label: "Discord", fields: [{ key: "botToken", label: "Bot token", secret: true }] },
  { id: "dingtalk", label: "DingTalk", fields: [{ key: "appKey", label: "App key" }, { key: "appSecret", label: "App secret", secret: true }] },
  { id: "slack", label: "Slack", fields: [{ key: "botToken", label: "Bot token", secret: true }, { key: "signingSecret", label: "Signing secret", secret: true }] },
  { id: "whatsapp", label: "WhatsApp", fields: [{ key: "phoneNumberId", label: "Phone number ID" }, { key: "accessToken", label: "Access token", secret: true }] },
  { id: "line", label: "LINE", fields: [{ key: "channelAccessToken", label: "Channel access token", secret: true }, { key: "channelSecret", label: "Channel secret", secret: true }] },
];

const DEFAULT_PORT = 8789;
const DEFAULT_PATH = "/im/webhook";
const DEFAULT_WORKSPACE_ROOT = "~/.deepseekgui/claw";

interface SettingsChannelsSectionProps {
  readonly channels: readonly ImChannel[];
  readonly onSaveChannel: (input: SaveImChannelInput) => Promise<void>;
  readonly onRemoveChannel: (channelId: string) => Promise<void>;
  readonly availableProviders?: readonly ImProvider[];
  readonly futureProviders?: readonly ImProvider[];
  readonly emptyTitle?: string;
  readonly emptyDescription?: string;
  readonly formTitle?: string;
  readonly formDescription?: string;
  readonly initialProvider?: ImProvider;
}

type CredentialDraft = Record<string, string>;

export function SettingsChannelsSection({
  channels,
  onSaveChannel,
  onRemoveChannel,
  availableProviders,
  futureProviders = [],
  emptyTitle = "No channels configured",
  emptyDescription = "Add Telegram, Discord, Feishu, WeChat, Slack, DingTalk, WhatsApp, or LINE below.",
  formTitle,
  formDescription = "Fields and credential names match Kun IM provider parameters.",
  initialProvider = "telegram",
}: SettingsChannelsSectionProps) {
  const providerOptions = useMemo(
    () => availableProviders
      ? PROVIDERS.filter((item) => availableProviders.includes(item.id))
      : [...PROVIDERS],
    [availableProviders],
  );
  const initial = providerOptions.some((item) => item.id === initialProvider)
    ? initialProvider
    : providerOptions[0]?.id ?? "feishu";
  const [editingId, setEditingId] = useState<string | undefined>();
  const editingChannel = useMemo(
    () => channels.find((channel) => channel.id === editingId),
    [channels, editingId],
  );
  const [provider, setProvider] = useState<ImProvider>(initial);
  const [label, setLabel] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [credential, setCredential] = useState<CredentialDraft>({});
  const [agentProfile, setAgentProfile] = useState<ImAgentProfile>(() => defaultAgentProfile(initial));
  const [settings, setSettings] = useState<ImSettings>(() => defaultSettings(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const selectedProvider = providerOptions.find((item) => item.id === provider) ?? providerOptions[0] ?? PROVIDERS[0]!;
  const endpoint = `http://127.0.0.1:${settings.port}${settings.path.startsWith("/") ? settings.path : `/${settings.path}`}`;

  function resetForm(nextProvider: ImProvider = initial) {
    setEditingId(undefined);
    setProvider(nextProvider);
    setLabel("");
    setEnabled(true);
    setCredential({});
    setAgentProfile(defaultAgentProfile(nextProvider));
    setSettings(defaultSettings(nextProvider));
    setError("");
  }

  function editChannel(channel: ImChannel) {
    setEditingId(channel.id);
    setProvider(channel.provider);
    setLabel(channel.label);
    setEnabled(channel.enabled);
    setCredential(credentialToDraft(channel.credential));
    setAgentProfile(channel.agentProfile);
    setSettings(channel.settings);
    setError("");
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      await onSaveChannel({
        ...(editingId ? { id: editingId } : {}),
        provider,
        label: label.trim() || selectedProvider.label,
        enabled,
        credential: buildCredential(provider, credential),
        agentProfile,
        settings: {
          ...settings,
          enabled,
          provider,
          path: settings.path.trim() || DEFAULT_PATH,
          port: clampInteger(settings.port, 1024, 65535, DEFAULT_PORT),
          responseTimeoutMs: clampInteger(settings.responseTimeoutMs, 5_000, 600_000, 120_000),
        },
      });
      resetForm(provider);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SettingsGroup title="Connected channels" description="IM providers that can route remote messages into pi sessions.">
        {channels.length === 0 ? (
          <SettingsRow title={emptyTitle} description={emptyDescription} />
        ) : channels.map((channel) => (
          <SettingsRow
            key={channel.id}
            title={channel.label}
            description={`${labelForProvider(channel.provider)} · ${channel.enabled ? "enabled" : "disabled"} · ${channel.status}`}
          >
            <div className="settings-row__control" style={{ display: "flex", gap: 8 }}>
              <button className="button button--secondary" type="button" onClick={() => editChannel(channel)}>Edit</button>
              <button className="button button--secondary" type="button" onClick={() => void onRemoveChannel(channel.id)}>Remove</button>
            </div>
          </SettingsRow>
        ))}
      </SettingsGroup>

      <SettingsGroup
        title={editingChannel ? `Edit ${editingChannel.label}` : (formTitle ?? "Add channel")}
        description={formDescription}
      >
        <SettingsRow title="Provider" description="Select the IM platform for this channel.">
          <select className="settings-input" value={provider} onChange={(event) => {
            const nextProvider = event.target.value as ImProvider;
            setProvider(nextProvider);
            setCredential({});
            setAgentProfile((current) => ({ ...current, name: current.name || nextProvider }));
            setSettings((current) => ({ ...current, provider: nextProvider }));
          }}>
            {providerOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </SettingsRow>
        <SettingsRow title="Label" description="Name shown in channel lists.">
          <input className="settings-input" value={label} onChange={(event) => setLabel(event.target.value)} placeholder={selectedProvider.label} />
        </SettingsRow>
        <SettingsRow title="Enabled" description="Disable to keep credentials saved without starting the channel.">
          <input aria-label="Channel enabled" checked={enabled} type="checkbox" onChange={(event) => setEnabled(event.currentTarget.checked)} />
        </SettingsRow>
        {selectedProvider.fields.map((field) => (
          <SettingsRow key={field.key} title={field.label} description={field.key}>
            {field.key === "domain" ? (
              <select
                className="settings-input"
                value={credential.domain ?? "feishu"}
                onChange={(event) => setCredential((current) => ({ ...current, domain: event.target.value }))}
              >
                <option value="feishu">feishu</option>
                <option value="lark">lark</option>
              </select>
            ) : (
              <input
                className="settings-input"
                type={field.secret ? "password" : "text"}
                value={credential[field.key] ?? ""}
                onChange={(event) => setCredential((current) => ({ ...current, [field.key]: event.target.value }))}
              />
            )}
          </SettingsRow>
        ))}
        <SettingsRow title="Run mode" description="Matches Kun steer/follow-up execution mode defaults.">
          <select className="settings-input" value={settings.mode} onChange={(event) => setSettings((current) => ({ ...current, mode: event.target.value === "plan" ? "plan" : "agent" }))}>
            <option value="agent">agent</option>
            <option value="plan">plan</option>
          </select>
        </SettingsRow>
        <SettingsRow title="Model" description="Kun model used for IM replies.">
          <select className="settings-input" value={settings.model} onChange={(event) => setSettings((current) => ({ ...current, model: event.target.value }))}>
            <option value="auto">auto</option>
            <option value="deepseek-v4-pro">deepseek-v4-pro</option>
            <option value="deepseek-v4-flash">deepseek-v4-flash</option>
          </select>
        </SettingsRow>
        <SettingsRow title="Workspace root" description="Default workspace for remote conversations.">
          <input className="settings-input" value={settings.workspaceRoot} onChange={(event) => setSettings((current) => ({ ...current, workspaceRoot: event.target.value }))} />
        </SettingsRow>
        <SettingsRow title="Webhook endpoint" description={endpoint}>
          <div className="settings-inline-fields">
            <input className="settings-input" type="number" min={1024} max={65535} value={settings.port} onChange={(event) => setSettings((current) => ({ ...current, port: Number(event.target.value) }))} />
            <input className="settings-input" value={settings.path} onChange={(event) => setSettings((current) => ({ ...current, path: event.target.value }))} />
          </div>
        </SettingsRow>
        <SettingsRow title="Webhook secret" description="Optional shared secret for webhook verification.">
          <input className="settings-input" type="password" value={settings.secret} onChange={(event) => setSettings((current) => ({ ...current, secret: event.target.value }))} />
        </SettingsRow>
        <SettingsRow title="Response timeout" description="Milliseconds to wait for a Kun turn result.">
          <input className="settings-input" type="number" min={5000} max={600000} value={settings.responseTimeoutMs} onChange={(event) => setSettings((current) => ({ ...current, responseTimeoutMs: Number(event.target.value) }))} />
        </SettingsRow>
        <SettingsRow title="Agent name" description="Persona name used when replying from IM.">
          <input className="settings-input" value={agentProfile.name} onChange={(event) => setAgentProfile((current) => ({ ...current, name: event.target.value }))} />
        </SettingsRow>
        <SettingsRow title="Agent description" description="Short description stored with the channel profile.">
          <input className="settings-input" value={agentProfile.description} onChange={(event) => setAgentProfile((current) => ({ ...current, description: event.target.value }))} />
        </SettingsRow>
        <SettingsRow title="Agent profile" description="Identity, personality, user context, and reply rules are persisted with the channel.">
          <textarea
            className="settings-input"
            style={{ minHeight: 130 }}
            value={profileToText(agentProfile)}
            onChange={(event) => setAgentProfile(textToProfile(event.target.value, agentProfile.name, agentProfile.description))}
          />
        </SettingsRow>
        {error ? <SettingsRow title="Could not save" description={error} /> : null}
        <SettingsRow title="Actions">
          <div className="settings-row__control" style={{ display: "flex", gap: 8 }}>
            <button className="button button--primary" disabled={saving} type="button" onClick={() => void save()}>
              {saving ? "Saving..." : "Save channel"}
            </button>
            <button className="button button--secondary" type="button" onClick={() => resetForm(provider)}>Reset</button>
          </div>
        </SettingsRow>
      </SettingsGroup>
      {futureProviders.length > 0 ? (
        <SettingsGroup title="Coming next" description="These providers are planned for later integration.">
          {futureProviders.map((futureProvider) => (
            <SettingsRow
              key={futureProvider}
              title={labelForProvider(futureProvider)}
              description="Planned"
            >
              <span className="settings-row__value">Coming soon</span>
            </SettingsRow>
          ))}
        </SettingsGroup>
      ) : null}
    </>
  );
}

function defaultAgentProfile(provider: ImProvider): ImAgentProfile {
  return {
    name: provider,
    description: "",
    identity: "",
    personality: "",
    userContext: "",
    replyRules: "",
  };
}

function defaultSettings(provider: ImProvider): ImSettings {
  return {
    enabled: true,
    provider,
    port: DEFAULT_PORT,
    path: DEFAULT_PATH,
    secret: "",
    workspaceRoot: DEFAULT_WORKSPACE_ROOT,
    model: "auto",
    mode: "agent",
    responseTimeoutMs: 120_000,
  };
}

function labelForProvider(provider: ImProvider): string {
  return PROVIDERS.find((item) => item.id === provider)?.label ?? provider;
}

function credentialToDraft(credential: ImCredential): CredentialDraft {
  const { kind: _kind, ...rest } = credential;
  return Object.fromEntries(Object.entries(rest).map(([key, value]) => [key, String(value)]));
}

function buildCredential(provider: ImProvider, draft: CredentialDraft): ImCredential {
  switch (provider) {
    case "feishu":
      return {
        kind: "feishu",
        appId: draft.appId ?? "",
        appSecret: draft.appSecret ?? "",
        domain: draft.domain === "lark" ? "lark" : "feishu",
      };
    case "weixin":
      return { kind: "weixin", accountId: draft.accountId ?? "", sessionKey: draft.sessionKey ?? "" };
    case "telegram":
      return { kind: "telegram", botToken: draft.botToken ?? "" };
    case "discord":
      return { kind: "discord", botToken: draft.botToken ?? "" };
    case "dingtalk":
      return { kind: "dingtalk", appKey: draft.appKey ?? "", appSecret: draft.appSecret ?? "" };
    case "slack":
      return { kind: "slack", botToken: draft.botToken ?? "", signingSecret: draft.signingSecret ?? "" };
    case "whatsapp":
      return { kind: "whatsapp", phoneNumberId: draft.phoneNumberId ?? "", accessToken: draft.accessToken ?? "" };
    case "line":
      return { kind: "line", channelAccessToken: draft.channelAccessToken ?? "", channelSecret: draft.channelSecret ?? "" };
  }
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function profileToText(profile: ImAgentProfile): string {
  return [
    `identity: ${profile.identity}`,
    `personality: ${profile.personality}`,
    `userContext: ${profile.userContext}`,
    `replyRules: ${profile.replyRules}`,
  ].join("\n");
}

function textToProfile(text: string, name: string, description: string): ImAgentProfile {
  const values: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    values[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return {
    name,
    description,
    identity: values.identity ?? "",
    personality: values.personality ?? "",
    userContext: values.userContext ?? "",
    replyRules: values.replyRules ?? "",
  };
}
