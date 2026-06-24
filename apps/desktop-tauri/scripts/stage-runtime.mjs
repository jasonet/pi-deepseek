// Assembles the self-contained sidecar runtime that ships inside the Tauri .app.
//
// Output layout (gitignored build artifact): apps/desktop-tauri/src-tauri/sidecar/
//   server.mjs        - esbuild bundle of the Node sidecar (deps externalized)
//   node_modules/     - the externalized deps (@earendil-works/pi-coding-agent,
//                       node-pty), installed as a real on-disk tree
//   node              - the official, self-contained Node binary
//
// tauri.conf.json maps these into Contents/Resources/sidecar/, and lib.rs
// prefers the bundled node + Resources/sidecar/server.mjs so the shipped app
// needs no system Node and no global pi install.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  rmSync,
  cpSync,
  copyFileSync,
  chmodSync,
  createWriteStream,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, ".."); // apps/desktop-tauri
const sidecarDir = join(pkgRoot, "sidecar");
const stagingDir = join(sidecarDir, "staging");
const outDir = join(pkgRoot, "src-tauri", "sidecar");

// Pin the bundled Node runtime. Official nodejs.org builds are self-contained
// (link only macOS system frameworks), unlike Homebrew's Cellar-linked node.
const NODE_VERSION = "v22.23.0";

function log(msg) {
  process.stdout.write(`[stage-runtime] ${msg}\n`);
}

function run(cmd, args, opts = {}) {
  log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", ...opts });
}

// 1. Build the sidecar bundle (sidecar/dist/server.mjs).
run("node", [join(sidecarDir, "build.mjs")]);

// 2. Ensure the runtime node_modules exists (real on-disk package tree).
const stagedModules = join(stagingDir, "node_modules");
if (!existsSync(stagedModules)) {
  log("installing runtime deps (npm install --omit=dev)…");
  run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
    cwd: stagingDir,
  });
}

// 3. Resolve a self-contained Node binary, downloading the official build if
//    it is not already cached under the OS temp dir.
async function resolveNodeBinary() {
  const arch = process.arch; // arm64 / x64
  const tarName = `node-${NODE_VERSION}-${process.platform}-${arch}`;
  const cacheRoot = join(tmpdir(), tarName);
  const cachedBin = join(cacheRoot, "bin", "node");
  if (existsSync(cachedBin)) {
    log(`using cached node: ${cachedBin}`);
    return cachedBin;
  }
  const tarball = `${tarName}.tar.gz`;
  const url = `https://nodejs.org/dist/${NODE_VERSION}/${tarball}`;
  const tarPath = join(tmpdir(), tarball);
  log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`failed to download node: ${res.status} ${res.statusText}`);
  }
  await pipeline(res.body, createWriteStream(tarPath));
  run("tar", ["-xzf", tarPath, "-C", tmpdir()]);
  if (!existsSync(cachedBin)) {
    throw new Error(`node binary missing after extract: ${cachedBin}`);
  }
  return cachedBin;
}

const nodeBin = await resolveNodeBinary();

// 4. Assemble the output directory fresh.
log(`assembling ${outDir}`);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

copyFileSync(join(sidecarDir, "dist", "server.mjs"), join(outDir, "server.mjs"));

// Copy node_modules, dereferencing the handful of .bin symlinks is unnecessary
// because we drop .bin entirely (the sidecar imports packages, never execs the
// bin shims). Dropping .bin also keeps the Tauri resource copier symlink-free.
cpSync(stagedModules, join(outDir, "node_modules"), {
  recursive: true,
  filter: (src) => !src.split("/").includes(".bin"),
});

const outNode = join(outDir, "node");
copyFileSync(nodeBin, outNode);
chmodSync(outNode, 0o755);

log("done. self-contained runtime staged at src-tauri/sidecar/");
