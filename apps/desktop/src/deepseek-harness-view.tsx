import { useCallback, useEffect, useRef, useState } from "react";

import deepseekLogo from "../resources/providers/deepseek.png";
import { RefreshIcon } from "./icons";
import type { DshWebStatus, PiDesktopApi } from "./ipc";

interface DeepSeekHarnessViewProps { readonly api: PiDesktopApi; }

const PHASES = [
  ["runtime", "运行环境"], ["dependencies", "安装 DSH"],
  ["pojia", "Pojia 配置"], ["service", "启动服务"],
] as const;

function statusLabel(status: DshWebStatus): string {
  switch (status.state) {
    case "running": return "运行中";
    case "installing": return "正在安装";
    case "error": return "未运行";
    case "stopping": return "正在停止";
    case "idle": return "未启动";
    default: return "正在启动";
  }
}

export function DeepSeekHarnessView({ api }: DeepSeekHarnessViewProps) {
  const [status, setStatus] = useState<DshWebStatus>({ state: "starting" });
  const [frameLoaded, setFrameLoaded] = useState(false);
  const mounted = useRef(false);
  const epoch = useRef(0);
  const logsRef = useRef<HTMLPreElement>(null);
  const busy = ["starting", "installing", "launching", "stopping"].includes(status.state);

  const run = useCallback(async (restart = false) => {
    epoch.current++;
    setFrameLoaded(false);
    setStatus({ state: restart ? "stopping" : "starting" });
    try {
      const result = await (restart ? api.restartDshWeb() : api.startDshWeb());
      epoch.current++;
      if (mounted.current) setStatus(result);
    } catch (error) {
      epoch.current++;
      if (mounted.current) setStatus({ state: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [api]);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    void run();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const current = epoch.current;
      let running = false;
      try {
        const next = await api.getDshWebStatus();
        running = next.state === "running";
        if (active && current === epoch.current) setStatus(next);
      } catch {
        // A transient IPC failure must not hide an active installation.
      }
      if (active) timer = setTimeout(() => void poll(), running ? 3000 : 500);
    };
    timer = setTimeout(() => void poll(), 200);
    return () => { active = false; mounted.current = false; clearTimeout(timer); };
  }, [api, run]);

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [status.logs]);

  const phaseIndex = PHASES.findIndex(([phase]) => phase === status.phase);
  return (
    <section className="dsh-web" data-testid={status.state === "running" ? "dsh-web-surface" : undefined}>
      <header className="dsh-web__toolbar">
        <img className="dsh-web__logo" src={deepseekLogo} alt="" />
        <strong>DeepSeek Harness</strong>
        <span className="dsh-web__edition">{status.managed === false ? "外部服务" : "Pojia"}</span>
        <span className="dsh-web__connection" role="status">
          {busy ? <span className="dsh-web__spinner" aria-hidden="true" /> : <span className={status.state === "running" ? "dsh-web__dot dsh-web__dot--running" : "dsh-web__dot"} />}
          {statusLabel(status)}
          {status.state === "running" ? <code data-testid="dsh-web-port">127.0.0.1:{status.port}</code> : null}
        </span>
        <button className="button button--ghost dsh-web__restart" type="button"
          title={status.managed === false ? "重新连接 DSH 服务" : "重启 DSH 服务"}
          aria-label={status.managed === false ? "重新连接 DSH 服务" : "重启 DSH 服务"}
          disabled={busy} onClick={() => void run(true)}><RefreshIcon /></button>
      </header>
      {status.state === "running" ? (
        <div className="dsh-web__content">
          {!frameLoaded ? <div className="dsh-web__frame-loading" aria-live="polite">正在载入 DeepSeek Harness</div> : null}
          <iframe allow="clipboard-read; clipboard-write" className="dsh-web__frame"
            data-testid="dsh-web-frame" key={status.url} onLoad={() => setFrameLoaded(true)}
            sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
            src={status.url} title="DeepSeek Harness" />
        </div>
      ) : (
        <div className="dsh-web__setup" data-testid={status.state === "error" ? "dsh-web-error" : "dsh-web-loading"}>
          <div className="dsh-web__setup-heading">
            {busy ? <span className="dsh-web__spinner" aria-hidden="true" /> : null}
            <h1>{status.state === "error" ? "DeepSeek Harness 未运行" : status.state === "installing" ? "正在安装 Pojia Harness" : "正在启动 DeepSeek Harness"}</h1>
          </div>
          {status.managed !== false && busy ? (
            <>
              <ol className="dsh-web__phases">
                {PHASES.map(([phase, label], index) => <li key={phase} data-current={phase === status.phase} data-complete={index < phaseIndex}>
                  <span>{index < phaseIndex ? "✓" : index + 1}</span>{label}
                </li>)}
              </ol>
              <progress aria-label="安装进度" max={100} value={status.progress} />
              {status.progress !== undefined ? <span className="dsh-web__percentage">{status.progress}%</span> : null}
            </>
          ) : null}
          {status.state === "error" ? <><p role="alert">{status.message}</p>
            <button className="button button--primary" type="button" onClick={() => void run()}><RefreshIcon />重试</button></> : null}
          {status.logs?.length ? <pre className="dsh-web__logs" ref={logsRef} aria-label="安装与服务日志">{status.logs.join("\n")}</pre> : null}
        </div>
      )}
    </section>
  );
}
