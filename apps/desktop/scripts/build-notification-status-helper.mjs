import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const outputDir = path.join(desktopDir, "build", "native");

if (process.platform !== "darwin") {
  console.log("Skipping native helper build outside macOS.");
  process.exit(0);
}

await mkdir(outputDir, { recursive: true });
const moduleCacheDir = path.join(process.env.TMPDIR || os.tmpdir(), "swift-module-cache");
await mkdir(moduleCacheDir, { recursive: true });

const helpers = [
  {
    source: path.join(desktopDir, "resources", "notification-status-helper.swift"),
    output: path.join(outputDir, "pi-deepseek-notification-status-helper"),
  },
  {
    source: path.join(desktopDir, "resources", "system-permission-helper.swift"),
    output: path.join(outputDir, "pi-deepseek-permission-helper"),
  },
];

for (const { source, output } of helpers) {
  try {
    const arm64Out = `${output}-arm64`;
    const x64Out = `${output}-x64`;
    await execFileAsync("swiftc", ["-target", "arm64-apple-macos12.0", source, "-module-cache-path", moduleCacheDir, "-O", "-o", arm64Out], {
      cwd: desktopDir,
    });
    await execFileAsync("swiftc", ["-target", "x86_64-apple-macos12.0", source, "-module-cache-path", moduleCacheDir, "-O", "-o", x64Out], {
      cwd: desktopDir,
    });
    await execFileAsync("lipo", ["-create", "-output", output, arm64Out, x64Out], {
      cwd: desktopDir,
    });
    await execFileAsync("codesign", ["--force", "--sign", "-", output], {
      cwd: desktopDir,
    });
    console.log(`Built universal native helper at ${output}`);
  } catch (error) {
    console.warn(`Failed to build universal native helper, falling back to host arch ${source}:`, error);
    try {
      await execFileAsync("swiftc", [source, "-module-cache-path", moduleCacheDir, "-O", "-o", output], {
        cwd: desktopDir,
      });
      await execFileAsync("codesign", ["--force", "--sign", "-", output], {
        cwd: desktopDir,
      });
      console.log(`Built native helper at ${output}`);
    } catch (fallbackError) {
      console.warn(`Failed to build native helper ${source}:`, fallbackError);
    }
  }
}
