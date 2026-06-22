#!/usr/bin/env node
// Ensures the vendored pi-mcp-bridge extension has its node_modules before
// electron-builder ships it via extraResources. The extension source lives in
// apps/desktop/resources/extensions/pi-mcp-bridge and is seeded into
// ~/.pi/agent/extensions on first run (see electron/seed-extensions.ts).
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extDir = path.resolve(scriptDir, "..", "resources", "extensions", "pi-mcp-bridge");

if (!existsSync(path.join(extDir, "package.json"))) {
  console.error(`[stage-mcp-bridge] vendored extension not found at ${extDir}`);
  process.exit(1);
}

if (existsSync(path.join(extDir, "node_modules", "@modelcontextprotocol", "sdk"))) {
  console.log("[stage-mcp-bridge] node_modules already present, skipping install.");
  process.exit(0);
}

const hasLock = existsSync(path.join(extDir, "package-lock.json"));
const args = hasLock ? ["ci", "--omit=dev"] : ["install", "--omit=dev"];
console.log(`[stage-mcp-bridge] npm ${args.join(" ")} in ${extDir}`);
const result = spawnSync("npm", args, { cwd: extDir, stdio: "inherit" });
process.exit(result.status ?? 1);
