import { useCallback, useEffect, useState } from "react";

import deepseekLogo from "../resources/providers/deepseek.png";
import type { DshWebStatus, PiDesktopApi } from "./ipc";

interface DeepSeekHarnessViewProps {
  readonly api: PiDesktopApi;
}

export function DeepSeekHarnessView({ api }: DeepSeekHarnessViewProps) {
  const [status, setStatus] = useState<DshWebStatus>({ state: "starting" });
  const [frameLoaded, setFrameLoaded] = useState(false);

  const connect = useCallback(async () => {
    setFrameLoaded(false);
    setStatus({ state: "starting" });
    try {
      setStatus(await api.startDshWeb());
    } catch (error) {
      setStatus({
        state: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [api]);

  useEffect(() => {
    void connect();
  }, [connect]);

  useEffect(() => {
    if (status.state !== "running") return undefined;
    const interval = window.setInterval(() => {
      void api.getDshWebStatus().then((nextStatus) => {
        if (nextStatus.state !== "running") setStatus(nextStatus);
      });
    }, 3_000);
    return () => window.clearInterval(interval);
  }, [api, status]);

  if (status.state === "error") {
    return (
      <section className="dsh-web dsh-web--status" data-testid="dsh-web-error">
        <img className="dsh-web__logo" src={deepseekLogo} alt="" />
        <h1>DeepSeek Harness 未运行</h1>
        <p>{status.message}</p>
        <button className="button button--primary" type="button" onClick={() => void connect()}>
          重试
        </button>
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
