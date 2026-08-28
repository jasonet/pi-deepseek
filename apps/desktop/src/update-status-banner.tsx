import type { DesktopUpdateStatus } from "./ipc";
import { useT } from "./i18n";

interface UpdateStatusBannerProps {
  readonly status: DesktopUpdateStatus;
  readonly onDownload: () => void;
  readonly onRetry: () => void;
  readonly onRestart: () => void;
  readonly onLater: () => void;
}

export function UpdateStatusBanner({
  status,
  onDownload,
  onRetry,
  onRestart,
  onLater,
}: UpdateStatusBannerProps) {
  const t = useT();
  if (!shouldShowUpdateStatus(status)) return null;

  const version = status.latestVersion || t("update.newVersion");
  const percent = Math.round(status.percent ?? 0);
  const isDownloading = status.phase === "downloading";

  return (
    <aside className={`update-status update-status--${status.phase}`} aria-live="polite" data-testid="update-status">
      <div className="update-status__mark" aria-hidden="true">
        {status.phase === "ready" ? <CheckIcon /> : <DownloadIcon />}
      </div>
      <div className="update-status__content">
        <div className="update-status__heading">
          <strong>{titleForStatus(status, version, t)}</strong>
          {isDownloading ? <span className="update-status__percent">{percent}%</span> : null}
        </div>
        <p>{descriptionForStatus(status, t)}</p>
        {isDownloading ? (
          <>
            <div
              className="update-status__track"
              role="progressbar"
              aria-label={t("update.downloadProgress")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <span style={{ width: `${percent}%` }} />
            </div>
            {status.total ? (
              <div className="update-status__meta">
                {formatBytes(status.transferred ?? 0)} / {formatBytes(status.total)}
                {status.bytesPerSecond ? ` · ${formatBytes(status.bytesPerSecond)}/s` : ""}
              </div>
            ) : null}
          </>
        ) : null}
        {status.phase === "error" && status.message ? (
          <div className="update-status__meta update-status__meta--error">{status.message}</div>
        ) : null}
      </div>
      <div className="update-status__actions">
        {status.phase === "available" ? (
          <>
            <button className="button button--secondary" type="button" onClick={onLater}>
              {t("update.later")}
            </button>
            <button className="button button--primary" type="button" onClick={onDownload}>
              {t("update.upgrade")}
            </button>
          </>
        ) : null}
        {status.phase === "ready" ? (
          <>
            <button className="button button--secondary" type="button" onClick={onLater}>
              {t("update.later")}
            </button>
            <button className="button button--primary" type="button" onClick={onRestart}>
              {t("update.restart")}
            </button>
          </>
        ) : null}
        {status.phase === "error" ? (
          <>
            <button className="button button--secondary" type="button" onClick={onLater}>
              {t("update.dismiss")}
            </button>
            <button className="button button--primary" type="button" onClick={onRetry}>
              {t("update.retry")}
            </button>
          </>
        ) : null}
      </div>
    </aside>
  );
}

function shouldShowUpdateStatus(status: DesktopUpdateStatus): boolean {
  return ["available", "downloading", "ready", "error"].includes(status.phase);
}

function titleForStatus(
  status: DesktopUpdateStatus,
  version: string,
  t: (key: string, vars?: Record<string, string>) => string,
): string {
  switch (status.phase) {
    case "available": return t("update.available", { version });
    case "downloading": return t("update.downloading", { version });
    case "ready": return t("update.ready", { version });
    default: return t("update.failed");
  }
}

function descriptionForStatus(
  status: DesktopUpdateStatus,
  t: (key: string, vars?: Record<string, string>) => string,
): string {
  switch (status.phase) {
    case "available": return t("update.availableDesc");
    case "downloading": return t("update.downloadingDesc");
    case "ready": return t("update.readyDesc");
    default: return t("update.failedDesc");
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 19h14" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}
