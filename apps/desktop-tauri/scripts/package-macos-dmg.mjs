import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const targetDir = join(appRoot, "src-tauri", "target", "release", "bundle");
const appPath = join(targetDir, "macos", "Pi-Deepseek.app");
const config = JSON.parse(readFileSync(join(appRoot, "src-tauri", "tauri.conf.json"), "utf8"));
const dmgDir = join(targetDir, "dmg");
const arch = process.arch === "arm64" ? "aarch64" : process.arch;
const dmgPath = join(dmgDir, `Pi-Deepseek_${config.version}_${arch}.dmg`);
const stagingDir = join(dmgDir, ".staging");

function run(command, args) {
  process.stdout.write(`[package-macos-dmg] $ ${command} ${args.join(" ")}\n`);
  execFileSync(command, args, { stdio: "inherit" });
}

try {
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });

  cpSync(appPath, join(stagingDir, "Pi-Deepseek.app"), { recursive: true });
  run("codesign", ["--force", "--deep", "--sign", "-", join(stagingDir, "Pi-Deepseek.app")]);
  run("codesign", ["--verify", "--deep", "--strict", join(stagingDir, "Pi-Deepseek.app")]);
  symlinkSync("/Applications", join(stagingDir, "Applications"));

  run("hdiutil", [
    "create",
    "-volname",
    "Pi-Deepseek",
    "-srcfolder",
    stagingDir,
    "-ov",
    "-format",
    "UDZO",
    dmgPath,
  ]);
  run("codesign", ["--force", "--sign", "-", dmgPath]);
  run("codesign", ["--verify", "--verbose=2", dmgPath]);
} finally {
  rmSync(stagingDir, { recursive: true, force: true });
}

process.stdout.write(`[package-macos-dmg] created ${dmgPath}\n`);
