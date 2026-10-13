import { useCallback, useEffect, useRef, useState } from "react";

import deepseekLogo from "../resources/providers/deepseek.png";
import type { DshWebStatus, PiDesktopApi } from "./ipc";

interface DeepSeekHarnessViewProps {
  readonly api: PiDesktopApi;
}

export function DeepSeekHarnessView({ api }: DeepSeekHarnessViewProps) {
  const [status, setStatus] = useState<DshWebStatus>({ state: "starting" });
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [launching, setLaunching] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // On mount: probe whether dsh is already running
  const probe = useCallback(async () => {
    setFrameLoaded(false);
    setStatus({ state: "starting" });
    try {
      const s = await api.startDshWeb();
      if (mountedRef.current) setStatus(s);
    } catch (error) {
      if (mountedRef.current) {
        setStatus({
          state: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }, [api]);

  useEffect(() => {
    void probe();
  }, [probe]);

  // Poll while running to detect disconnection
  useEffect(() => {
    if (status.state !== "running") return undefined;
    const interval = window.setInterval(() => {
      void api.getDshWebStatus().then((next) => {
        if (mountedRef.current && next.state !== "running") setStatus(next);
      });
    }, 3_000);
    return () => window.clearInterval(interval);
  }, [api, status]);

  // One-click launch: spawn dsh web in background
  const handleLaunch = useCallback(async () => {
    setLaunching(true);
    setStatus({ state: "launching" });
    try {
      const s = await api.launchDshWeb();
      if (mountedRef.current) {
        setStatus(s);
        setFrameLoaded(false);
      }
    } catch (error) {
      if (mountedRef.current) {
        setStatus({
          state: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      if (mountedRef.current) setLaunching(false);
    }
  }, [api]);

  // Not running → show launch button
  if (status.state === "error") {
    return (
      <section className="dsh-web dsh-web--status" data-testid="dsh-web-error">
        <img className="dsh-web__logo" src={deepseekLogo} alt="" />
        <h1>DeepSeek Harness 未运行</h1>
        <p style={{ marginBottom: 16, color: "var(--muted-strong)", fontSize: 13 }}>
          {status.message}
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <button
            className="button button--primary"
            type="button"
            disabled={launching}
            onClick={() => void handleLaunch()}
          >
            {launching ? "启动中…" : "一键启动 DSH Web"}
          </button>
          <button className="button button--ghost" type="button" onClick={() => void probe()}>
            重新检测
          </button>
        </div>
      </section>
    );
  }

  if (status.state === "launching") {
    return (
      <section className="dsh-web dsh-web--status" data-testid="dsh-web-launching">
        <img className="dsh-web__logo dsh-web__logo--loading" src={deepseekLogo} alt="" />
        <h1>正在启动 DeepSeek Harness…</h1>
        <p style={{ color: "var(--muted-strong)", fontSize: 13 }}>
          首次启动需要下载依赖，请稍候（最多 30 秒）
        </p>
      </section>
    );
  }

  if (status.state !== "running") {
    return (
      <section className="dsh-web dsh-web--status" data-testid="dsh-web-loading">
        <img className="dsh-web__logo dsh-web__logo--loading" src={deepseekLogo} alt="" />
        <h1>正在检测 DeepSeek Harness</h1>
      </section>
    );
  }

  return (
    <section className="dsh-web" data-testid="dsh-web-surface">
      {!frameLoaded ? (
        <div className="dsh-web__frame-loading" aria-live="polite">正在载入 DeepSeek Harness</div>
      ) : null}
      <iframe
        allow="clipboard-read; clipboard-write"
        className="dsh-web__frame"
        data-testid="dsh-web-frame"
        onLoad={() => setFrameLoaded(true)}
        sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
        src={status.url}
        title="DeepSeek Harness"
      />
    </section>
  );
}
