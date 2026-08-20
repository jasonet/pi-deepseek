// Assembles the self-contained sidecar runtime that ships inside the Tauri .app.
//
// Output layout (gitignored build artifact): apps/desktop-tauri/src-tauri/sidecar/
//   server.mjs        - esbuild bundle of the Node sidecar (deps externalized)
//   node_modules/     - externalized runtime deps installed as a real tree
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
  readdirSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, ".."); // apps/desktop-tauri
const sidecarDir = join(pkgRoot, "sidecar");
const stagingDir = join(sidecarDir, "staging");
const outDir = join(pkgRoot, "src-tauri", "sidecar");
const desktopRoot = join(pkgRoot, "..", "desktop");

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

function retainRuntimeTarget(parentDir, target) {
  if (!existsSync(parentDir)) {
    return;
  }
  for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
    if (entry.name !== target) {
      rmSync(join(parentDir, entry.name), { recursive: true, force: true });
    }
  }
}

function pruneNativePackages(modulesDir) {
  const nodePtyDir = join(modulesDir, "node-pty");
  const nodePtyTarget = join(nodePtyDir, "prebuilds", `${process.platform}-${process.arch}`);
  retainRuntimeTarget(join(nodePtyDir, "prebuilds"), `${process.platform}-${process.arch}`);
  const spawnHelper = join(nodePtyTarget, "spawn-helper");
  if (existsSync(spawnHelper)) {
    chmodSync(spawnHelper, 0o755);
  }
  for (const entry of ["binding.gyp", "deps", "scripts", "src", "third_party", "typings"]) {
    rmSync(join(nodePtyDir, entry), { recursive: true, force: true });
  }

  const koffiDir = join(modulesDir, "koffi");
  retainRuntimeTarget(join(koffiDir, "build", "koffi"), `${process.platform}_${process.arch}`);
  for (const entry of ["doc", "src", "vendor"]) {
    rmSync(join(koffiDir, entry), { recursive: true, force: true });
  }
}

// 1. Build the sidecar bundle (sidecar/dist/server.mjs).
run("node", [join(sidecarDir, "build.mjs")]);
run("node", [join(desktopRoot, "scripts", "stage-mcp-bridge.mjs")]);

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
mkdirSync(join(outDir, "extensions"), { recursive: true });
for (const id of ["pi-mcp-unity", "pi-mcp-higgsfield", "pi-understand", "pi-treg"]) {
  copyFileSync(
    join(desktopRoot, "resources", "extensions", `${id}.tgz`),
    join(outDir, "extensions", `${id}.tgz`),
  );
}

// Copy node_modules, dereferencing the handful of .bin symlinks is unnecessary
// because we drop .bin entirely (the sidecar imports packages, never execs the
// bin shims). Dropping .bin also keeps the Tauri resource copier symlink-free.
cpSync(stagedModules, join(outDir, "node_modules"), {
  recursive: true,
  filter: (src) => !src.split("/").includes(".bin"),
});
pruneNativePackages(join(outDir, "node_modules"));

const outNode = join(outDir, "node");
copyFileSync(nodeBin, outNode);
chmodSync(outNode, 0o755);
if (process.platform === "darwin") {
  run("strip", ["-x", outNode]);
  run("codesign", ["--force", "--sign", "-", outNode]);
}

const runtimeProbe = [
  `const koffi = require(${JSON.stringify(join(outDir, "node_modules", "koffi"))});`,
  `if (!koffi) throw new Error("koffi failed to load");`,
  `const pty = require(${JSON.stringify(join(outDir, "node_modules", "node-pty"))});`,
  `const shell = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "/bin/sh";`,
  `const args = process.platform === "win32" ? ["/d", "/s", "/c", "echo|set /p=PI_TAURI_PTY_OK"] : ["-lc", "printf PI_TAURI_PTY_OK"];`,
  `const child = pty.spawn(shell, args, { cols: 80, rows: 24 });`,
  `let output = "";`,
  `child.onData((data) => { output += data; });`,
  `child.onExit(() => { if (!output.includes("PI_TAURI_PTY_OK")) process.exit(1); });`,
].join("\n");
run(outNode, ["-e", runtimeProbe]);

const sidecarUrl = pathToFileURL(join(outDir, "server.mjs")).href;
run(outNode, ["--input-type=module", "-e", `await import(${JSON.stringify(sidecarUrl)}); process.exit(0);`]);

log("done. self-contained runtime staged at src-tauri/sidecar/");
