import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  copyFileSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const FX_VERSION = "v0.0.5";
const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, "..");
const outputRoot = join(desktopRoot, "resources", "fx");
const releases = {
  "darwin-arm64": {
    target: "macos-aarch64",
    sha256: "2b98cc1a85c1cf5ea213f1df71cca79f7cbff65793d2a87282c04ca019cbd1c1",
  },
  "darwin-x64": {
    target: "macos-x86_64",
    sha256: "0da4a90034c1afcd251a1a2cb237ea3a0013c965ad8c2a45b7713694b530ad8a",
  },
  "linux-arm64": {
    target: "linux-aarch64",
    sha256: "8bbcde6a41256c4fac4e0a022291cf02740419e27afabde3b8f45e7a4e393edb",
  },
  "linux-x64": {
    target: "linux-x86_64",
    sha256: "d5639d173267774aa8228a474baf619a7076ac41a91023915007c865143429b1",
  },
};

function log(message) {
  process.stdout.write(`[stage-fx] ${message}\n`);
}
function hostTarget() {
  return `${process.platform}-${process.arch}`;
}
function candidateLocalBinary(target) {
  if (target !== hostTarget()) return undefined;
  const explicit = process.env.PI_FX_BUNDLED_BINARY;
  if (explicit && existsSync(explicit)) return explicit;
  const sibling = join(
    desktopRoot,
    "..",
    "..",
    "..",
    "fx",
    "zig-out",
    "bin",
    "fx",
  );
  if (!existsSync(sibling)) return undefined;
  const version = execFileSync(sibling, ["--version"], { encoding: "utf8" })
    .trim()
    .replace(/^v/, "");
  return version === FX_VERSION.replace(/^v/, "") ? sibling : undefined;
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok || !response.body)
    throw new Error(`Download failed (${response.status}): ${url}`);
  await pipeline(response.body, createWriteStream(destination));
}

async function stageTarget(target) {
  const release = releases[target];
  if (!release) {
    log(
      `${target}: upstream fx has no supported bundled runtime; continuing without fx`,
    );
    return;
  }
  const destination = join(outputRoot, target);
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  const localBinary = candidateLocalBinary(target);
  if (localBinary) {
    copyFileSync(localBinary, join(destination, "fx"));
    chmodSync(join(destination, "fx"), 0o755);
    for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
      const adjacentSource = join(dirname(localBinary), name);
      const repoSource = join(desktopRoot, "..", "..", "..", "fx", name);
      const source = existsSync(adjacentSource) ? adjacentSource : repoSource;
      if (existsSync(source)) copyFileSync(source, join(destination, name));
    }
    log(`${target}: bundled local fx from ${localBinary}`);
    return;
  }

  const archive = `fx-${release.target}.tar.gz`;
  const baseUrl = `https://github.com/vercel-labs/fx/releases/download/${FX_VERSION}`;
  const cacheDir = join(tmpdir(), `pi-gui-fx-${FX_VERSION}`);
  mkdirSync(cacheDir, { recursive: true });
  const archivePath = join(cacheDir, archive);
  if (!existsSync(archivePath))
    await download(`${baseUrl}/${archive}`, archivePath);
  const actual = createHash("sha256")
    .update(readFileSync(archivePath))
    .digest("hex");
  if (release.sha256 !== actual)
    throw new Error(`SHA-256 mismatch for ${basename(archivePath)}`);
  execFileSync("tar", ["-xzf", archivePath, "-C", destination], {
    stdio: "inherit",
  });
  chmodSync(join(destination, "fx"), 0o755);
  log(`${target}: bundled fx ${FX_VERSION} (${actual.slice(0, 12)}…)`);
}

const targets = (process.env.PI_FX_STAGE_TARGETS ?? hostTarget())
  .split(",")
  .map((target) => target.trim())
  .filter(Boolean);
mkdirSync(outputRoot, { recursive: true });
for (const target of targets) await stageTarget(target);
