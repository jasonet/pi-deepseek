import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { SettingsIcon, SparkIcon } from "./icons";
import type { PiDesktopApi, TradingPreferences } from "./ipc";
import "./trading.css";

const EXAMPLES = { overview: "跨市场研究", crypto: "BTC 现货", us: "AAPL 美股", cn: "600519 A 股" } as const;

export function TradingControls({ api, frame, frameGeneration, url }: {
  api: PiDesktopApi; frame: RefObject<HTMLIFrameElement | null>; frameGeneration: number; url?: string;
}) {
  const [preferences, setPreferences] = useState<TradingPreferences>();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState(false);
  const [error, setError] = useState("");
  const attempted = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pending = useRef(new Map<string, { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>());

  useEffect(() => {
    if (settings) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [settings]);

  useEffect(() => {
    let active = true;
    api.getTradingPreferences?.().then((value) => { if (active) setPreferences(value); })
      .catch((cause) => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, [api]);

  useEffect(() => {
    setReady(false);
    if (!url) return;
    const origin = new URL(url).origin;
    const requests = pending.current;
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== origin || event.data?.channel !== "taosi-trading") return;
      if (event.data.ready) { setReady(true); clearInterval(timer); }
      const request = requests.get(event.data.requestId);
      if (!request) return;
      clearTimeout(request.timer);
      requests.delete(event.data.requestId);
      if (event.data.ok) request.resolve();
      else request.reject(new Error(event.data.message || "交易界面操作失败"));
    };
    window.addEventListener("message", listener);
    const timer = setInterval(() => frame.current?.contentWindow?.postMessage({ channel: "taosi-trading", action: "ping", requestId: "ready" }, origin), 1000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("message", listener);
      for (const request of requests.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("交易页面已关闭"));
      }
      requests.clear();
    };
  }, [frame, frameGeneration, url]);

  const request = useCallback((action: "settings" | "example", example?: TradingPreferences["example"]) => {
    if (!url || !frame.current?.contentWindow) return Promise.reject(new Error("交易服务尚未就绪"));
    const requestId = crypto.randomUUID();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { pending.current.delete(requestId); reject(new Error("交易界面响应超时，请重试")); }, 15_000);
      pending.current.set(requestId, { resolve, reject, timer });
      frame.current!.contentWindow!.postMessage({ channel: "taosi-trading", requestId, action, example }, new URL(url).origin);
    });
  }, [frame, url]);

  const save = useCallback(async (patch: Partial<TradingPreferences>) => {
    if (!api.setTradingPreferences) throw new Error("交易配置接口不可用");
    setPreferences(await api.setTradingPreferences(patch));
  }, [api]);

  const prepare = useCallback(async () => {
    if (!preferences) return;
    setBusy(true); setError("");
    try {
      await request("example", preferences.example);
      await save({ examplePrepared: true });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }, [preferences, request, save]);

  useEffect(() => {
    if (!ready || !preferences || !preferences.autoPrepareExample || preferences.examplePrepared || attempted.current) return;
    attempted.current = true;
    void prepare();
  }, [ready, preferences, prepare]);

  return <>
    <button type="button" className="button button--ghost dsh-web__restart" title="新建分析案例" aria-label="新建分析案例"
      disabled={!ready || busy || !preferences} onClick={() => void prepare()}><SparkIcon /></button>
    <button type="button" className="button button--ghost dsh-web__restart" title="Trading 配置" aria-label="Trading 配置"
      onClick={() => setSettings(true)}><SettingsIcon /></button>
    {error && !settings ? <div className="trading-error" role="alert">{error}</div> : null}
    <dialog ref={dialogRef} aria-label="Trading 配置" className="trading-settings" onCancel={() => setSettings(false)}>
        <h2>Trading 配置</h2>
        {error ? <p role="alert">{error}</p> : null}
        <label className="trading-settings__row">默认分析案例
          <select aria-label="默认分析案例" disabled={!preferences || busy} value={preferences?.example ?? "overview"}
            onChange={(event) => void save({ example: event.target.value as TradingPreferences["example"] }).catch((cause) => setError(String(cause)))}>
            {Object.entries(EXAMPLES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label className="trading-settings__row">首次打开时准备案例草稿
          <input type="checkbox" checked={preferences?.autoPrepareExample ?? false} disabled={!preferences || busy}
            onChange={(event) => void save({ autoPrepareExample: event.target.checked }).catch((cause) => setError(String(cause)))} />
        </label>
        <div className="trading-settings__row"><span>DeepSeek 凭据</span><span>复用本机 Pi 配置（如已设置）</span></div>
        <div className="trading-settings__row"><span>初始交易模式</span><span>模拟交易</span></div>
        <div className="trading-settings__row"><span>组件许可</span><span>PolyForm 非商业许可</span></div>
        <div className="trading-settings__actions">
          <button type="button" className="button button--primary" disabled={!ready} onClick={() => {
            void request("settings").then(() => setSettings(false)).catch((cause) => setError(String(cause)));
          }}>市场与账户配置</button>
          <button type="button" className="button button--ghost" onClick={() => setSettings(false)}>关闭</button>
        </div>
    </dialog>
  </>;
}
