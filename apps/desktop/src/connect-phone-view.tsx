import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type {
  ConnectPhoneProvider,
  ConnectPhoneQrStartResult,
  ImAgentProfile,
  ImChannel,
  ImProvider,
  ImSettings,
  SaveImChannelInput,
} from "./desktop-state";

interface ConnectPhoneViewProps {
  readonly channels: readonly ImChannel[];
  readonly onSaveChannel: (input: SaveImChannelInput) => Promise<void>;
  readonly onRemoveChannel: (channelId: string) => Promise<void>;
  readonly onConnected: (provider: ConnectPhoneProvider, sessionId?: string) => void;
}

const PROVIDERS: readonly { id: ConnectPhoneProvider; label: string; description: string }[] = [
  { id: "weixin", label: "微信", description: "微信机器人通过 Tailscale 或局域网 IP 发送消息到本地 webhook。" },
  { id: "feishu", label: "飞书", description: "使用飞书/Lark 官方授权二维码完成个人应用安装。" },
];

const FUTURE_PROVIDERS: readonly { id: ImProvider; label: string }[] = [
  { id: "telegram", label: "Telegram" },
  { id: "whatsapp", label: "WhatsApp" },
];

type InstallStatus = "idle" | "loading" | "scanning" | "saving" | "connected" | "error";

export function ConnectPhoneView({
  channels,
  onSaveChannel,
  onRemoveChannel,
  onConnected,
}: ConnectPhoneViewProps) {
  const phoneChannels = useMemo(
    () => channels.filter((channel) => channel.provider === "weixin" || channel.provider === "feishu"),
    [channels],
  );
  const [provider, setProvider] = useState<ConnectPhoneProvider>("weixin");
  const [isLark, setIsLark] = useState(false);
  const [installQr, setInstallQr] = useState<Extract<ConnectPhoneQrStartResult, { readonly ok: true }> | null>(null);
  const [status, setStatus] = useState<InstallStatus>("idle");
  const [message, setMessage] = useState("");
  const selectedProvider = useMemo(
    () => PROVIDERS.find((item) => item.id === provider) ?? PROVIDERS[0]!,
    [provider],
  );

  useEffect(() => {
    if (!installQr) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      const api = window.piApp;
      if (!api) {
        setStatus("error");
        setMessage("桌面桥接未就绪，请重新打开 Pi-Deepseek。");
        return;
      }

      try {
        const result = await api.pollConnectPhoneQr(provider, installQr.deviceCode);
        if (cancelled) return;
        if (result.done) {
          setStatus("saving");
          await onSaveChannel(createChannelInput(result.provider, result.credential, phoneChannels));
          if (cancelled) return;
          setStatus("connected");
          setMessage(`${labelForProvider(result.provider)} 已连接。`);
          setInstallQr(null);
          onConnected(result.provider);
          return;
        }
        if (result.message) {
          setStatus("error");
          setMessage(result.message);
          return;
        }
        timer = setTimeout(poll, Math.max(installQr.interval, 2) * 1000);
      } catch (error) {
        if (cancelled) return;
        setStatus("error");
        setMessage(error instanceof Error ? error.message : String(error));
      }
    };

    timer = setTimeout(poll, provider === "weixin" ? 0 : 1200);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [installQr, onSaveChannel, phoneChannels, provider]);

  async function startInstall(nextProvider = provider) {
    const api = window.piApp;
    if (!api) {
      setStatus("error");
      setMessage("桌面桥接未就绪，请重新打开 Pi-Deepseek。");
      return;
    }

    // WeChat: save channel directly without QR code (use webhook)
    if (nextProvider === "weixin") {
      setStatus("saving");
      await onSaveChannel({
        provider: "weixin",
        label: "微信",
        enabled: true,
        status: "running",
        credential: { kind: "weixin", accountId: "direct", sessionKey: "webhook" },
        agentProfile: { name: "微信", description: "", identity: "", personality: "", userContext: "", replyRules: "" },
        settings: { enabled: true, provider: "weixin", port: 8789, path: "/im/webhook", secret: "", workspaceRoot: "~/.deepseekgui/claw", model: "auto", mode: "agent", responseTimeoutMs: 120_000 },
      });
      setStatus("connected");
      setMessage(`微信已连接。Webhook: :8789/im/webhook`);
      onConnected(nextProvider);
      return;
    }

    // Feishu: use QR code flow
    setProvider(nextProvider);
    setInstallQr(null);
    setStatus("loading");
    setMessage("");
    const result = await api.startConnectPhoneQr({ provider: nextProvider, isLark: nextProvider === "feishu" && isLark });
    if (!result.ok) {
      setStatus("error");
      setMessage(result.message);
      return;
    }
    setInstallQr(result);
    setStatus("scanning");
    setMessage("请使用飞书扫码完成授权。");
  }

  function switchProvider(nextProvider: ConnectPhoneProvider) {
    setProvider(nextProvider);
    setInstallQr(null);
    setStatus("idle");
    setMessage("");
  }

  return (
    <section className="canvas">
      <div className="conversation settings-view connect-phone" data-testid="connect-phone-surface">
        <header className="view-header">
          <div>
            <div className="chat-header__eyebrow">Pi-Deepseek</div>
            <h1 className="view-header__title">连接手机</h1>
            <p className="view-header__body">
              通过扫码把微信或飞书连接到 pi 会话；生成和轮询机制与 Kun 的 IM 安装流程保持一致。
            </p>
          </div>
        </header>

        <div className="connect-phone__layout">
          <section className="connect-phone__providers" aria-label="连接方式">
            {PROVIDERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`connect-phone__provider ${provider === item.id ? "connect-phone__provider--active" : ""}`}
                onClick={() => switchProvider(item.id)}
              >
                <span className="connect-phone__provider-title">{item.label}</span>
                <span className="connect-phone__provider-description">{item.description}</span>
              </button>
            ))}
          </section>

          <section className="connect-phone__qr-panel" aria-live="polite">
            <div className="connect-phone__qr-header">
              <div>
                <h2>{selectedProvider.label}</h2>
                <p>{selectedProvider.description}</p>
              </div>
              {provider === "feishu" ? (
                <select className="settings-input connect-phone__domain" value={isLark ? "lark" : "feishu"} onChange={(event) => setIsLark(event.target.value === "lark")}>
                  <option value="feishu">飞书</option>
                  <option value="lark">Lark</option>
                </select>
              ) : null}
            </div>

            <div className="connect-phone__qr-box">
              {installQr ? (
                installQr.url.startsWith("data:image/") ? (
                  <img className="connect-phone__qr-image" src={installQr.url} alt={`${selectedProvider.label} 登录二维码`} />
                ) : (
                  <QRCodeSVG value={installQr.url} size={400} marginSize={2} level="M" style={{ width: "100%", height: "100%" }} />
                )
              ) : (
                <div className="connect-phone__qr-placeholder">
                  <span>{status === "loading" ? "生成中" : "扫码连接"}</span>
                </div>
              )}
            </div>

            {installQr?.userCode ? (
              <div className="connect-phone__code">验证码：{installQr.userCode}</div>
            ) : null}

            <p className={`connect-phone__status connect-phone__status--${status}`}>{message || statusText(status)}</p>

            <div className="connect-phone__actions">
              <button className="button button--primary" type="button" disabled={status === "loading" || status === "saving"} onClick={() => void startInstall()}>
                {installQr ? "重新生成二维码" : "生成二维码"}
              </button>
              {installQr ? (
                <button className="button button--secondary" type="button" onClick={() => {
                  setInstallQr(null);
                  setStatus("idle");
                  setMessage("");
                }}>
                  取消
                </button>
              ) : null}
            </div>
          </section>

          <section className="connect-phone__channels">
            <h2>已连接</h2>
            {phoneChannels.length === 0 ? (
              <p className="connect-phone__muted">还没有连接手机。先生成二维码并用手机扫码。</p>
            ) : phoneChannels.map((channel) => (
              <div className="connect-phone__channel" key={channel.id}>
                <div>
                  <strong>{channel.label}</strong>
                  <span>{labelForProvider(channel.provider)} · {channel.enabled ? "enabled" : "disabled"} · {channel.status}</span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="button button--primary" style={{ fontSize: 12, padding: "4px 12px" }} type="button" onClick={() => onConnected(channel.provider, channel.sessionId)}>进入会话</button>
                  <button className="button button--secondary" type="button" onClick={() => void onRemoveChannel(channel.id)}>移除</button>
                </div>
              </div>
            ))}
          </section>

          <section className="connect-phone__future">
            <h2>后续计划</h2>
            {FUTURE_PROVIDERS.map((item) => (
              <div className="connect-phone__future-row" key={item.id}>
                <span>{item.label}</span>
                <span>Coming soon</span>
              </div>
            ))}
          </section>
        </div>
      </div>
    </section>
  );
}

function createChannelInput(
  provider: ConnectPhoneProvider,
  credential: SaveImChannelInput["credential"],
  channels: readonly ImChannel[],
): SaveImChannelInput {
  const existing = channels.find((channel) => channel.provider === provider);
  return {
    ...(existing ? { id: existing.id } : {}),
    provider,
    label: labelForProvider(provider),
    enabled: true,
    status: "running",
    credential,
    agentProfile: defaultAgentProfile(provider),
    settings: defaultSettings(provider),
  };
}

function defaultAgentProfile(provider: ConnectPhoneProvider): ImAgentProfile {
  return {
    name: labelForProvider(provider),
    description: "",
    identity: "",
    personality: "",
    userContext: "",
    replyRules: "",
  };
}

function defaultSettings(provider: ConnectPhoneProvider): ImSettings {
  return {
    enabled: true,
    provider,
    port: 8788,
    path: "/im/webhook",
    secret: "",
    workspaceRoot: "~/.deepseekgui/claw",
    model: "auto",
    mode: "agent",
    responseTimeoutMs: 120_000,
  };
}

function labelForProvider(provider: ImProvider): string {
  if (provider === "weixin") return "微信";
  if (provider === "feishu") return "飞书";
  return provider;
}

function statusText(status: InstallStatus): string {
  switch (status) {
    case "loading":
      return "正在生成二维码...";
    case "scanning":
      return "等待手机扫码确认...";
    case "saving":
      return "正在保存连接...";
    case "connected":
      return "已连接。";
    case "error":
      return "连接失败。";
    case "idle":
      return "生成二维码后，用手机扫码完成连接。";
  }
}
