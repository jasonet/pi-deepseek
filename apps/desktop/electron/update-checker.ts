import { app, net, Notification, shell } from "electron";

const RELEASES_PAGE =
  "https://github.com/jasonet/pi-deepseek/releases/latest";
const FEED_BASE_URL =
  "https://github.com/jasonet/pi-deepseek/releases/latest/download";

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const INITIAL_DELAY_MS = 15_000; // 15 seconds after launch

export type UpdateCheckResult =
  | { status: "up-to-date"; currentVersion: string; latestVersion: string }
  | { status: "update-available"; currentVersion: string; latestVersion: string }
  | { status: "error"; message: string };

function showUpdateNotification(currentVersion: string, latestVersion: string): void {
  const notification = new Notification({
    title: "Pi-Deepseek Release Available",
    body: `Version ${latestVersion} is available (you have ${currentVersion}). Click to view the release.`,
  });
  notification.on("click", () => {
    shell.openExternal(RELEASES_PAGE);
  });
  notification.show();
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const feedUrl = `${FEED_BASE_URL}/${getUpdateFeedFileName()}`;
  const res = await net.fetch(feedUrl);
  if (!res.ok) {
    return {
      status: "error",
      message: `GitHub release feed returned ${res.status}.`,
    };
  }

  const feed = await res.text();
  const latest = readFeedVersion(feed);
  if (!latest) {
    return {
      status: "error",
      message: "GitHub release feed did not return a version.",
    };
  }

  const current = app.getVersion();

  if (latest !== current) {
    showUpdateNotification(current, latest);
    return {
      status: "update-available",
      currentVersion: current,
      latestVersion: latest,
    };
  }

  return {
    status: "up-to-date",
    currentVersion: current,
    latestVersion: latest,
  };
}

function getUpdateFeedFileName(): string {
  if (process.platform === "darwin") {
    return "latest-mac.yml";
  }
  if (process.platform === "win32") {
    return "latest.yml";
  }
  return "latest-linux.yml";
}

function readFeedVersion(feed: string): string | undefined {
  const match = /^version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(feed);
  return match?.[1]?.trim().replace(/^v/, "") || undefined;
}

export function initUpdateChecker(): () => void {
  const noop = (e: Error) =>
    console.warn("Update check failed:", e.message);

  const timeout = setTimeout(() => {
    void checkForUpdate().catch(noop);
  }, INITIAL_DELAY_MS);
  const interval = setInterval(() => {
    void checkForUpdate().catch(noop);
  }, CHECK_INTERVAL_MS);

  return () => {
    clearTimeout(timeout);
    clearInterval(interval);
  };
}
