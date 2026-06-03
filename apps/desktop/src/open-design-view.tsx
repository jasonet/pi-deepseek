import { useEffect, useState } from "react";
import type { OpenDesignStatus, PiDesktopApi } from "./ipc";
import { useT } from "./i18n";

interface OpenDesignViewProps {
  readonly api: PiDesktopApi;
}

export function OpenDesignView({ api }: OpenDesignViewProps) {
  const t = useT();
  const [status, setStatus] = useState<OpenDesignStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [frameKey, setFrameKey] = useState(0);

  async function refresh() {
    setLoading(true);
    try {
      setStatus(await api.getOpenDesignStatus());
    } catch (error) {
      setStatus({
        daemonUrl: "",
        webUrl: "",
        reachable: false,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  }

  async function start() {
    setStarting(true);
    try {
      const nextStatus = await api.startOpenDesign();
      setStatus(nextStatus);
      if (nextStatus.reachable) {
        setFrameKey((current) => current + 1);
      }
    } catch (error) {
      setStatus((current) => ({
        daemonUrl: current?.daemonUrl ?? "",
        webUrl: current?.webUrl ?? "",
        reachable: false,
        daemonReachable: current?.daemonReachable,
        webReachable: current?.webReachable,
        message: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setStarting(false);
      setLoading(false);
    }
  }

  useEffect(() => {
    void start();
  }, []);

  const reachable = Boolean(status?.reachable);
  const statusText = loading
    ? t("common.loading")
    : starting
      ? t("openDesign.starting")
    : reachable
      ? t("openDesign.statusReady")
      : t("openDesign.statusStopped");

  return (
    <section className="open-design-view">
      <header className="open-design-view__header">
        <div>
          <div className="view-header__eyebrow">{t("openDesign.eyebrow")}</div>
          <h1>{t("openDesign.title")}</h1>
          <p>{t("openDesign.description")}</p>
        </div>
        <div className="view-header__actions">
          <button className="button button--secondary" disabled={loading || starting} type="button" onClick={() => void refresh()}>
            {t("common.refresh")}
          </button>
          <button className="button button--secondary" disabled={!status?.webUrl} type="button" onClick={() => void api.openOpenDesignExternal()}>
            {t("openDesign.openBrowser")}
          </button>
          <button className="button button--primary" disabled={starting} type="button" onClick={() => void start()}>
            {starting ? t("openDesign.starting") : reachable ? t("openDesign.reload") : t("openDesign.start")}
          </button>
        </div>
      </header>

      <div className={`open-design-status ${reachable ? "open-design-status--ready" : ""}`}>
        <span>{statusText}</span>
        {status?.daemonReachable != null ? (
          <span>{status.daemonReachable ? t("openDesign.daemonReady") : t("openDesign.daemonStopped")}</span>
        ) : null}
        {status?.webReachable != null ? (
          <span>{status.webReachable ? t("openDesign.webReady") : t("openDesign.webStopped")}</span>
        ) : null}
        {status?.version ? <span>Open Design {status.version}</span> : null}
        {status?.message && !reachable ? <span>{status.message}</span> : null}
        {status?.webUrl ? <span>{status.webUrl}</span> : null}
      </div>

      {reachable && status ? (
        <div className="open-design-frame-shell">
          <iframe
            key={`${status.webUrl}:${frameKey}`}
            className="open-design-frame"
            src={status.webUrl}
            title="Open Design"
            referrerPolicy="no-referrer"
          />
        </div>
      ) : (
        <div className="open-design-empty">
          <div className="empty-panel">
            <div className="session-header__eyebrow">{t("openDesign.localDaemon")}</div>
            <h2>{t("openDesign.emptyTitle")}</h2>
            <p>{t("openDesign.emptyDescription")}</p>
            <div className="empty-panel__actions">
              <button className="button button--primary" disabled={starting} type="button" onClick={() => void start()}>
                {starting ? t("openDesign.starting") : t("openDesign.start")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
