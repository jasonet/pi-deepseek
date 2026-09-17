import { gt, valid } from "semver";

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v(?=\d)/i, "");
}

export function isUpdateVersionNewer(latestVersion: string, currentVersion: string): boolean {
  const latest = valid(normalizeVersion(latestVersion));
  const current = valid(normalizeVersion(currentVersion));
  return latest !== null && current !== null && gt(latest, current);
}

/** Convert internal updater errors into concise user-facing text. */
export function humanizeUpdateError(message: string): string {
  if (/ENOENT/i.test(message)) return "Could not access the application package. Try reinstalling or check disk permissions.";
  if (/EACCES|EPERM/i.test(message)) return "Permission denied. Try running as administrator or check folder permissions.";
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(message)) return "Network error. Check your connection and try again.";
  if (/net::ERR_/i.test(message)) return "Download failed due to a network issue. Check your connection and try again.";
  if (/Cannot find latest-mac\.yml/i.test(message)) return "macOS update feed is temporarily unavailable on the release server. Please try again later.";
  if (/Cannot find latest\.yml/i.test(message)) return "Windows update feed is temporarily unavailable on the release server. Please try again later.";
  return message;
}
