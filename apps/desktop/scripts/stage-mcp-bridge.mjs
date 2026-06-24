#!/usr/bin/env node
// Prepares the vendored pi MCP extensions for packaging.
//
// Each extension lives in apps/desktop/resources/extensions/<id> (index.ts,
// mcp.json, package.json, package-lock.json tracked in git; node_modules
// produced here). electron-builder filters `node_modules` out of extraResources
// directories, so instead of shipping the raw folders we pack each extension
// (incl. node_modules) into a single tarball that the app extracts into
// ~/.pi/agent/extensions on first run (see seed-extensions.ts).
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Each entry: id + a representative installed package used as the "node_modules
// is materialized" sentinel (different per extension since they have disjoint
// dependency sets).
const EXTENSIONS = [
  { id: "pi-mcp-unity", sentinel: "@modelcontextprotocol/sdk" },
  { id: "pi-mcp-higgsfield", sentinel: "@modelcontextprotocol/sdk" },
  { id: "pi-understand", sentinel: "@understand-anything/core" },
];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.resolve(scriptDir, "..", "resources", "extensions");

for (const { id, sentinel } of EXTENSIONS) {
  const extDir = path.join(extRoot, id);
  if (!existsSync(path.join(extDir, "package.json"))) {
    console.error(`[stage-mcp-bridge] vendored extension not found at ${extDir}`);
    process.exit(1);
  }

  // 1. Ensure node_modules exists (reproducible on a fresh checkout).
  if (!existsSync(path.join(extDir, "node_modules", ...sentinel.split("/")))) {
    const hasLock = existsSync(path.join(extDir, "package-lock.json"));
    const args = hasLock ? ["ci", "--omit=dev"] : ["install", "--omit=dev"];
    console.log(`[stage-mcp-bridge] npm ${args.join(" ")} in ${extDir}`);
    // `shell: true` is required on Windows: npm is `npm.cmd`, and Node refuses
    // to spawn `.cmd`/`.bat` without a shell (CVE-2024-27980 hardening), so a
    // plain spawnSync("npm") fails with ENOENT before npm ever runs.
    const install = spawnSync("npm", args, { cwd: extDir, stdio: "inherit", shell: true });
    if (install.error) {
      console.error(`[stage-mcp-bridge] failed to launch npm: ${install.error.message}`);
      process.exit(1);
    }
    if ((install.status ?? 1) !== 0) process.exit(install.status ?? 1);
  } else {
    console.log(`[stage-mcp-bridge] ${id}: node_modules already present.`);
  }

  // 2. Pack the extension (incl. node_modules) into a tarball shipped as an
  //    extraResource. Top-level entry is `<id>/`.
  const tarball = path.join(extRoot, `${id}.tgz`);
  console.log(`[stage-mcp-bridge] creating ${tarball}`);
  const pack = spawnSync("tar", ["-czf", tarball, "-C", extRoot, id], { stdio: "inherit" });
  if ((pack.status ?? 1) !== 0) process.exit(pack.status ?? 1);
}

console.log("[stage-mcp-bridge] done.");
