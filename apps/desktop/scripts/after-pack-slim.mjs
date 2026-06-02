/**
 * afterPack hook — strip unused Electron components to reduce bundle size.
 * Removes: SwiftShader (GPU fallback, ~16MB), GLESv2 (~7MB), PDF plugin, EGL.
 */
import fs from "fs";
import path from "path";

export default async function afterPack(context) {
  const { appOutDir, packager } = context;

  if (packager.platform.nodeName !== "darwin") {
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
