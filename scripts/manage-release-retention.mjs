import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

const ROOT_DIR = path.resolve(import.meta.dirname, "..");
const DESKTOP_DIR = path.join(ROOT_DIR, "apps/desktop");
const RELEASE_DIR = path.join(DESKTOP_DIR, "release");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function getVersionsFromGitTags() {
  try {
    const raw = execFileSync("git", ["tag", "-l", "--sort=-v:refname"], {
      cwd: ROOT_DIR,
      encoding: "utf8",
    });
    return raw
      .split("\n")
      .map((t) => t.trim())
      .filter((t) => /^v\d+\.\d+\.\d+/.test(t))
      .map((t) => t.replace(/^v/, ""));
  } catch {
    return [];
  }
}

function parseSemver(v) {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

export function planRetention({
  latestVersion,
  previousVersion,
  desktopDir = DESKTOP_DIR,
}) {
  const releaseDir = path.join(desktopDir, "release");
  const keepVersions = new Set([latestVersion, previousVersion]);

  const toKeep = [];
  const toDelete = [];

  // 1. Check release-* directories inside apps/desktop
  if (fs.existsSync(desktopDir)) {
    const desktopEntries = fs.readdirSync(desktopDir, { withFileTypes: true });
    for (const entry of desktopEntries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith("release-")) {
        const verMatch = entry.name.match(/^release-(\d+\.\d+\.\d+)/);
        const fullPath = path.join(desktopDir, entry.name);
        if (verMatch) {
          const ver = verMatch[1];
          if (keepVersions.has(ver)) {
            toKeep.push({ path: fullPath, reason: `Matches version ${ver} (kept)` });
          } else {
            toDelete.push({ path: fullPath, reason: `Older release directory: ${entry.name}` });
          }
        } else if (entry.name === "release-signature-smoke") {
          toDelete.push({ path: fullPath, reason: `Temporary smoke test release directory: ${entry.name}` });
        }
      }
    }
  }

  // 2. Check files inside apps/desktop/release
  if (fs.existsSync(releaseDir)) {
    const releaseEntries = fs.readdirSync(releaseDir, { withFileTypes: true });
    for (const entry of releaseEntries) {
      const fullPath = path.join(releaseDir, entry.name);

      // Identify version from file name
      // Examples: Taosi-3.0.2-..., Pi-Deepseek-2.9.3-..., etc.
      const semverMatch = entry.name.match(/(\d+\.\d+\.\d+(?:\.\d+)?)/);
      if (semverMatch) {
        const ver = semverMatch[1];
        if (keepVersions.has(ver)) {
          toKeep.push({ path: fullPath, reason: `Matches retained version ${ver}` });
        } else {
          toDelete.push({ path: fullPath, reason: `Older release file (v${ver}): ${entry.name}` });
        }
        continue;
      }

      // Special files in release/
      if (entry.name.startsWith(".temp")) {
        toDelete.push({ path: fullPath, reason: `Temporary build artifact: ${entry.name}` });
      } else if (
        entry.name.startsWith("linux-") ||
        entry.name.startsWith("win-")
      ) {
        // Old cross-compilation unpacked folders from older releases (unless 3.0.2 generated)
        const stats = fs.statSync(fullPath);
        // If modified before September 2026, it's from 2.9.x
        toDelete.push({ path: fullPath, reason: `Legacy unpacked build folder: ${entry.name}` });
      } else if (
        entry.name === "SHA256SUMS-2.9.0.txt" ||
        entry.name === "SHA256SUMS.txt" ||
        entry.name === "checksums.txt" ||
        entry.name === "latest-linux-arm64.yml" ||
        entry.name === "latest-linux.yml" ||
        entry.name === "latest.yml"
      ) {
        toDelete.push({ path: fullPath, reason: `Stale checksum / manifest for legacy releases: ${entry.name}` });
      } else {
        toKeep.push({ path: fullPath, reason: `Current release configuration / artifact: ${entry.name}` });
      }
    }
  }

  return { toKeep, toDelete };
}

function getDirSize(dirPath) {
  let size = 0;
  try {
    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) return stats.size;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const sub = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        size += getDirSize(sub);
      } else {
        try {
          size += fs.statSync(sub).size;
        } catch {}
      }
    }
  } catch {}
  return size;
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      apply: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      latest: { type: "string" },
      previous: { type: "string" },
      "sync-app": { type: "boolean", default: false },
    },
    strict: true,
  });

  const rootPkg = readJson(path.join(ROOT_DIR, "package.json"));
  const gitTags = getVersionsFromGitTags();

  const latestVersion = values.latest || rootPkg.version;
  const previousVersion =
    values.previous ||
    gitTags.find((v) => compareSemver(v, latestVersion) < 0) ||
    "3.0.1";

  console.log(`[Release Retention Manager]`);
  console.log(`Latest version:   ${latestVersion} (RETAIN)`);
  console.log(`Previous version: ${previousVersion} (RETAIN for rollback)`);
  console.log(`Older versions:   < ${previousVersion} (DELETE)`);
  console.log();

  const { toKeep, toDelete } = planRetention({
    latestVersion,
    previousVersion,
  });

  console.log(`--- Files/Folders to KEEP (${toKeep.length}) ---`);
  for (const item of toKeep) {
    const rel = path.relative(ROOT_DIR, item.path);
    console.log(`  [KEEP] ${rel} (${item.reason})`);
  }

  console.log();
  console.log(`--- Files/Folders to DELETE (${toDelete.length}) ---`);
  let totalReclaimable = 0;
  for (const item of toDelete) {
    const size = getDirSize(item.path);
    totalReclaimable += size;
    const rel = path.relative(ROOT_DIR, item.path);
    console.log(`  [DEL]  ${rel} [${formatBytes(size)}] - ${item.reason}`);
  }

  console.log();
  console.log(`Total reclaimable disk space: ${formatBytes(totalReclaimable)}`);

  if (values.apply) {
    console.log("\nApplying deletions...");
    for (const item of toDelete) {
      if (fs.existsSync(item.path)) {
        fs.rmSync(item.path, { recursive: true, force: true });
        console.log(`  Deleted: ${path.relative(ROOT_DIR, item.path)}`);
      }
    }
    console.log("Cleanup complete.");
  } else {
    console.log("\n(Run with --apply to delete the above files and reclaim disk space)");
  }

  // App sync check
  const sourceApp = path.join(RELEASE_DIR, "mac-arm64", "Taosi.app");
  const altSourceApp = path.join(DESKTOP_DIR, `release-${latestVersion}`, "mac-arm64", "Taosi.app");
  const appPath = fs.existsSync(sourceApp) ? sourceApp : (fs.existsSync(altSourceApp) ? altSourceApp : null);

  console.log("\n[Application Sync Status (/Applications)]");
  if (appPath) {
    console.log(`Latest packaged app located at: ${path.relative(ROOT_DIR, appPath)}`);
    console.log(`To install/update to /Applications/Taosi.app for manual verification:`);
    console.log(`  rm -rf /Applications/Taosi.app && cp -R "${appPath}" /Applications/Taosi.app`);
  } else {
    console.log(`Latest app package not found for version ${latestVersion}. Run 'pnpm --filter @pi-gui/desktop run package' first.`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
