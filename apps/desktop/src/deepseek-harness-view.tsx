import { useCallback, useEffect, useRef, useState } from "react";

import deepseekLogo from "../resources/providers/deepseek.png";
import tradingLogo from "../resources/trading/icon.png";
import { TradingControls } from "./trading-controls";
import { RefreshIcon } from "./icons";
import type { DshWebMode, DshWebStatus, PiDesktopApi } from "./ipc";

interface DeepSeekHarnessViewProps {
  readonly api: PiDesktopApi;
  readonly mode?: DshWebMode;
}

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

export function DeepSeekHarnessView({ api, mode = "harness" }: DeepSeekHarnessViewProps) {
  const isBot = mode === "bot";
  const isTrading = mode === "trading";
  const title = isTrading ? "DSH Trading" : isBot ? "DeepSeek Bot" : "DeepSeek Harness";
  const testPrefix = isTrading ? "dsh-trading" : isBot ? "ds-bot" : "dsh-web";
  const phases = isTrading ? [["runtime", "运行环境"], ["dependencies", "安装交易组件"], ["pojia", "配置工作区"], ["service", "启动服务"]] as const : PHASES;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<DshWebStatus>({ state: "starting" });
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [frameGeneration, setFrameGeneration] = useState(0);
  const mounted = useRef(false);
  const epoch = useRef(0);
  const logsRef = useRef<HTMLPreElement>(null);
  const busy = ["starting", "installing", "launching", "stopping"].includes(status.state);

  const run = useCallback(async (restart = false) => {
    epoch.current++;
    setFrameLoaded(false);
    setStatus({ state: restart ? "stopping" : "starting" });
    try {
      const result = await (restart ? api.restartDshWeb(mode) : api.startDshWeb(mode));
      epoch.current++;
      if (mounted.current) setStatus(result);
    } catch (error) {
      epoch.current++;
      if (mounted.current) setStatus({ state: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [api, mode]);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    void run();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const current = epoch.current;
      let running = false;
      try {
        const next = await api.getDshWebStatus(mode);
        running = next.state === "running";
        if (active && current === epoch.current) setStatus(next);
      } catch {
        // A transient IPC failure must not hide an active installation.
      }
      if (active) timer = setTimeout(() => void poll(), running ? 3000 : 500);
    };
    timer = setTimeout(() => void poll(), 200);
    return () => { active = false; mounted.current = false; clearTimeout(timer); };
  }, [api, mode, run]);

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [status.logs]);

  const phaseIndex = phases.findIndex(([phase]) => phase === status.phase);
  return (
    <section className="dsh-web" data-testid={status.state === "running" ? `${testPrefix}-surface` : undefined}>
      <header className="dsh-web__toolbar">
        <img className="dsh-web__logo" src={isTrading ? tradingLogo : deepseekLogo} alt="" />
        <strong>{title}</strong>
        <span className="dsh-web__edition">{status.managed === false ? "外部服务" : isTrading ? "独立工作区" : isBot ? "DS Bot" : "标准版"}</span>
        <span className="dsh-web__connection" role="status">
          {busy ? <span className="dsh-web__spinner" aria-hidden="true" /> : <span className={status.state === "running" ? "dsh-web__dot dsh-web__dot--running" : "dsh-web__dot"} />}
          {statusLabel(status)}
          {status.state === "running" ? <code data-testid={`${testPrefix}-port`}>127.0.0.1:{status.port}</code> : null}
        </span>
        {isTrading ? <TradingControls api={api} frame={frameRef} frameGeneration={frameGeneration} url={status.state === "running" ? status.url : undefined} /> : null}
        <button className="button button--ghost dsh-web__restart" type="button"
          title={status.managed === false ? `重新连接 ${title} 服务` : `重启 ${title} 服务`}
          aria-label={status.managed === false ? `重新连接 ${title} 服务` : `重启 ${title} 服务`}
          disabled={busy} onClick={() => void run(true)}><RefreshIcon /></button>
      </header>
      {status.state === "running" ? (
        <div className="dsh-web__content">
          {!frameLoaded ? <div className="dsh-web__frame-loading" aria-live="polite">{`正在载入 ${title}`}</div> : null}
          <iframe ref={frameRef} allow="clipboard-read; clipboard-write" className="dsh-web__frame"
            data-testid={`${testPrefix}-frame`} key={status.url} onLoad={() => { setFrameLoaded(true); setFrameGeneration((value) => value + 1); }}
            sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
            src={status.url} title={title} />
        </div>
      ) : (
        <div className="dsh-web__setup" data-testid={`${testPrefix}-${status.state === "error" ? "error" : "loading"}`}>
          <div className="dsh-web__setup-heading">
            {busy ? <span className="dsh-web__spinner" aria-hidden="true" /> : null}
            <h1>{status.state === "error" ? `${title} 未运行` : status.state === "installing" ? "正在安装运行环境" : `正在启动 ${title}`}</h1>
          </div>
          {status.managed !== false && busy ? (
            <>
              <ol className="dsh-web__phases">
                {phases.map(([phase, label], index) => <li key={phase} data-current={phase === status.phase} data-complete={index < phaseIndex}>
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
