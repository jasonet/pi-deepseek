import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const BUNDLED_EXTENSIONS = [
  "pi-mcp-unity",
  "pi-mcp-higgsfield",
  "pi-understand",
  "pi-treg",
] as const;
const APP_MANAGED_EXTENSIONS = new Set<string>(["pi-treg"]);

export function seedBundledExtensionsFromPath(
  bundledRoot: string,
  targetRoot = path.join(homedir(), ".pi", "agent", "extensions"),
): void {
  if (!existsSync(bundledRoot)) return;
  for (const id of BUNDLED_EXTENSIONS) {
    const tarball = path.join(bundledRoot, `${id}.tgz`);
    const target = path.join(targetRoot, id);
    if (!existsSync(tarball)) continue;
    if (existsSync(target)) {
      if (!APP_MANAGED_EXTENSIONS.has(id)) continue;
      const bundledVersion = readBundledVersion(tarball, id);
      const installedVersion = readInstalledVersion(target);
      if (!bundledVersion || bundledVersion === installedVersion) continue;
    }
    try {
      mkdirSync(targetRoot, { recursive: true });
      const temporaryRoot = mkdtempSync(path.join(targetRoot, `.${id}-`));
      const result = spawnSync("tar", ["-xzf", tarball, "-C", temporaryRoot], { stdio: "ignore" });
      if ((result.status ?? 1) === 0) {
        rmSync(target, { recursive: true, force: true });
        renameSync(path.join(temporaryRoot, id), target);
        rmSync(temporaryRoot, { recursive: true, force: true });
        console.log(`[seed-extensions] installed ${id} -> ${target}`);
      } else {
        rmSync(temporaryRoot, { recursive: true, force: true });
        console.warn(`[seed-extensions] tar failed for ${id} (status ${result.status})`);
      }
    } catch (error) {
      console.warn(`[seed-extensions] failed to seed ${id}:`, error);
    }
  }
}

function readBundledVersion(tarball: string, id: string): string | undefined {
  const result = spawnSync("tar", ["-xOf", tarball, `${id}/package.json`], { encoding: "utf8" });
  if ((result.status ?? 1) !== 0) return undefined;
  return parsePackageVersion(result.stdout);
}

function readInstalledVersion(target: string): string | undefined {
  try {
    return parsePackageVersion(readFileSync(path.join(target, "package.json"), "utf8"));
  } catch {
    return undefined;
  }
}

function parsePackageVersion(text: string): string | undefined {
  try {
    const value = JSON.parse(text) as { version?: unknown };
    return typeof value.version === "string" ? value.version : undefined;
  } catch {
    return undefined;
  }
}
