import { gt, valid } from "semver";

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v(?=\d)/i, "");
}

export function isUpdateVersionNewer(latestVersion: string, currentVersion: string): boolean {
  const latest = valid(normalizeVersion(latestVersion));
  const current = valid(normalizeVersion(currentVersion));
  return latest !== null && current !== null && gt(latest, current);
}
