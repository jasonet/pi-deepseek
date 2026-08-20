import { app } from "electron";
import path from "node:path";
import { seedBundledExtensionsFromPath } from "./seed-extensions-core";

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
export function seedBundledExtensions(): void {
  // In dev the bundled tarball doesn't exist under resourcesPath; skip.
  if (!app.isPackaged) return;
  const bundledRoot = path.join(process.resourcesPath, "extensions");
  seedBundledExtensionsFromPath(bundledRoot);
}
