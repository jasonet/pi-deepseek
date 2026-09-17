import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const desktopDir = path.join(rootDir, "apps", "desktop");
const rootPkgPath = path.join(rootDir, "package.json");

const originalPkgText = readFileSync(rootPkgPath, "utf8");
const pkg = JSON.parse(originalPkgText);
const originalPM = pkg.packageManager;
const version = pkg.version;

console.log(`[win-build] Starting Windows build for Taosi v${version}...`);

try {
  // Step 1: Build desktop assets using pnpm
  console.log(`[win-build] Step 1: Building desktop app assets with pnpm...`);
  execFileSync("pnpm", ["run", "build"], {
    cwd: desktopDir,
    stdio: "inherit",
    env: process.env,
  });

  // Step 2: Temporarily set packageManager to traversal so electron-builder uses traversal collector
  pkg.packageManager = "traversal";
  writeFileSync(rootPkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`[win-build] Switched packageManager to traversal for electron-builder.`);

  // Step 3: Run electron-builder for Windows x64
  console.log(`[win-build] Step 2: Packaging Windows targets (nsis + portable)...`);
  execFileSync(
    "npx",
    ["electron-builder", "--win", "--x64", "--publish", "never", "-c.npmRebuild=false"],
    {
      cwd: desktopDir,
      stdio: "inherit",
      env: {
        ...process.env,
        COREPACK_ENABLE_STRICT: "0",
      },
    }
  );

  // Restore packageManager immediately after packaging
  writeFileSync(rootPkgPath, originalPkgText);
  console.log(`[win-build] Restored packageManager to ${originalPM}`);

  console.log(`[win-build] Step 3: Verifying packaged Windows runtime dependencies...`);
  execFileSync(
    process.execPath,
    [path.join(desktopDir, "scripts", "assert-runtime-model-registry.mjs")],
    { cwd: desktopDir, stdio: "inherit" }
  );

  execFileSync(
    process.execPath,
    [path.join(desktopDir, "scripts", "assert-packaged-runtime-deps.mjs")],
    {
      cwd: desktopDir,
      stdio: "inherit",
      env: {
        ...process.env,
        PI_APP_PACKAGE_PLATFORM: "win",
      },
    }
  );

  console.log(`[win-build] Step 4: Verifying Windows update assets...`);
  execFileSync(
    process.execPath,
    [path.join(desktopDir, "scripts", "assert-windows-update-assets.mjs")],
    {
      cwd: desktopDir,
      stdio: "inherit",
      env: {
        ...process.env,
        PI_APP_RELEASE_VERSION: version,
      },
    }
  );

  console.log(`[win-build] Step 5: Uploading Windows release assets to GitHub release v${version}...`);
  const assets = [
    path.join(desktopDir, "release", `Taosi-${version}-win-x64-setup.exe`),
    path.join(desktopDir, "release", `Taosi-${version}-win-x64-setup.exe.blockmap`),
    path.join(desktopDir, "release", `Taosi-${version}-win-x64-portable.exe`),
    path.join(desktopDir, "release", "latest.yml"),
  ];

  for (const asset of assets) {
    if (!existsSync(asset)) {
      throw new Error(`Expected asset missing: ${asset}`);
    }
  }

  execFileSync(
    "gh",
    ["release", "upload", `v${version}`, ...assets, "-R", "jasonet/pi-deepseek", "--clobber"],
    { cwd: rootDir, stdio: "inherit" }
  );

  console.log(`\n[win-build] SUCCESS! Taosi v${version} Windows build and release complete.`);
} finally {
  writeFileSync(rootPkgPath, originalPkgText);
  console.log(`[win-build] Restored packageManager to ${originalPM}`);
}
