/**
 * afterPack hook — strip unused Electron components and non-host fx binaries.
 */
import fs from "fs";
import path from "path";

export default async function afterPack(context) {
  const { appOutDir, arch, packager } = context;
  const platform = packager.platform.nodeName;
  const archName = { 1: "x64", 3: "arm64" }[arch];
  const resourcesPath = platform === "darwin"
    ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, "Contents", "Resources")
    : path.join(appOutDir, "resources");
  const fxRoot = path.join(resourcesPath, "fx");

  if (fs.existsSync(fxRoot) && archName && (platform === "darwin" || platform === "linux")) {
    const activeTarget = `${platform}-${archName}`;
    for (const target of fs.readdirSync(fxRoot)) {
      if (target !== activeTarget) fs.rmSync(path.join(fxRoot, target), { recursive: true, force: true });
    }
    console.log(`[afterPack] Kept fx runtime: ${activeTarget}`);
  } else if (fs.existsSync(fxRoot) && platform === "win32") {
    fs.rmSync(fxRoot, { recursive: true, force: true });
  }

  if (platform !== "darwin") {
    console.log("[afterPack] Skipping — not macOS");
    return;
  }

  const frameworkPath = path.join(
    appOutDir,
    `${packager.appInfo.productFilename}.app`,
    "Contents", "Frameworks",
    "Electron Framework.framework", "Versions", "A"
  );

  // Only SwiftShader is safe to remove — it's a software GPU fallback
  // GLESv2/EGL are required by Electron's rendering pipeline
  const toRemove = [
    "Libraries/libvk_swiftshader.dylib",
  ];

  let removed = 0;
  for (const file of toRemove) {
    const fullPath = path.join(frameworkPath, file);
    if (fs.existsSync(fullPath)) {
      const stat = fs.statSync(fullPath);
      fs.unlinkSync(fullPath);
      removed += stat.size;
      console.log(`[afterPack] Removed: ${file} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
    }
  }

  console.log(`[afterPack] Total saved: ${(removed / 1024 / 1024).toFixed(1)}MB`);
}
