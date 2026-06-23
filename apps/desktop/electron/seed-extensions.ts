import { app } from "electron";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Seeds bundled pi extensions into the user's shared agent dir on first run.
 *
 * The desktop app and the `pi` CLI share `~/.pi/agent`, so extensions placed in
 * `~/.pi/agent/extensions/<id>` are auto-discovered by the runtime. We ship the
 * MCP Bridge extension inside the app bundle as a tarball (extraResources →
 * `resources/extensions/<id>.tgz`) because electron-builder strips `node_modules`
 * from extraResources directories. On first run we extract it once.
 *
 * Policy: only seed when the target directory does NOT already exist. We never
 * overwrite an existing extension, so a user's local edits and mcp.json toggles
 * (enabled flags, tokens) are preserved.
 */
const BUNDLED_EXTENSIONS = ["pi-mcp-unity", "pi-mcp-higgsfield", "pi-understand"] as const;

function agentExtensionsDir(): string {
  return path.join(homedir(), ".pi", "agent", "extensions");
}

export function seedBundledExtensions(): void {
  // In dev the bundled tarball doesn't exist under resourcesPath; skip.
  if (!app.isPackaged) return;
  const bundledRoot = path.join(process.resourcesPath, "extensions");
  if (!existsSync(bundledRoot)) return;

  const targetRoot = agentExtensionsDir();
  for (const id of BUNDLED_EXTENSIONS) {
    const tarball = path.join(bundledRoot, `${id}.tgz`);
    const target = path.join(targetRoot, id);
    if (!existsSync(tarball)) continue;
    if (existsSync(target)) continue; // never overwrite a user's install
    try {
      mkdirSync(targetRoot, { recursive: true });
      // The tarball's top-level entry is `<id>/`, so extracting into targetRoot
      // yields targetRoot/<id>. `tar` ships with macOS/Linux and Windows 10+.
      const result = spawnSync("tar", ["-xzf", tarball, "-C", targetRoot], {
        stdio: "ignore",
      });
      if ((result.status ?? 1) === 0) {
        console.log(`[seed-extensions] installed ${id} -> ${target}`);
      } else {
        console.warn(`[seed-extensions] tar failed for ${id} (status ${result.status})`);
      }
    } catch (error) {
      console.warn(`[seed-extensions] failed to seed ${id}:`, error);
    }
  }
}
