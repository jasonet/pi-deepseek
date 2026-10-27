import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findBuiltMacApp, planRetention, previousBuiltVersion } from "./manage-release-retention.mjs";

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "retention-test-"));
  const releaseDir = path.join(tempDir, "release");
  fs.mkdirSync(releaseDir, { recursive: true });

  // Create simulated directories and files
  fs.mkdirSync(path.join(tempDir, "release-3.0.2"));
  fs.mkdirSync(path.join(tempDir, "release-3.0.1"));
  fs.mkdirSync(path.join(tempDir, "release-2.9.3"));
  fs.mkdirSync(path.join(tempDir, "release-signature-smoke"));

  fs.writeFileSync(path.join(releaseDir, "Taosi-3.0.2-mac-arm64.dmg"), "dummy");
  fs.writeFileSync(path.join(releaseDir, "Taosi-3.0.2-mac-x64.dmg"), "dummy");
  fs.writeFileSync(path.join(releaseDir, "Pi-Deepseek-2.9.3-mac-arm64.dmg"), "dummy");
  fs.writeFileSync(path.join(releaseDir, "Pi-Deepseek-2.8.0-mac-arm64.dmg"), "dummy");
  fs.writeFileSync(path.join(releaseDir, ".temp0123-Pi-Deepseek-0.2.5.1-mac-arm64.dmg"), "dummy");
  fs.writeFileSync(path.join(releaseDir, "latest-mac.yml"), "dummy");

  const plan = planRetention({
    latestVersion: "3.0.2",
    previousVersion: "3.0.1",
    desktopDir: tempDir,
  });

  const keptPaths = plan.toKeep.map((k) => path.basename(k.path));
  const deletedPaths = plan.toDelete.map((d) => path.basename(d.path));

  // Must keep 3.0.2 and 3.0.1
  assert.ok(keptPaths.includes("release-3.0.2"), "Should keep release-3.0.2");
  assert.ok(keptPaths.includes("release-3.0.1"), "Should keep release-3.0.1");
  assert.ok(keptPaths.includes("Taosi-3.0.2-mac-arm64.dmg"), "Should keep 3.0.2 dmg");
  assert.ok(keptPaths.includes("Taosi-3.0.2-mac-x64.dmg"), "Should keep 3.0.2 x64 dmg");
  assert.ok(keptPaths.includes("latest-mac.yml"), "Should keep latest-mac.yml");

  // Must delete older release and temporary files
  assert.ok(deletedPaths.includes("release-2.9.3"), "Should delete release-2.9.3");
  assert.ok(deletedPaths.includes("release-signature-smoke"), "Should delete release-signature-smoke");
  assert.ok(deletedPaths.includes("Pi-Deepseek-2.9.3-mac-arm64.dmg"), "Should delete older 2.9.3 dmg");
  assert.ok(deletedPaths.includes("Pi-Deepseek-2.8.0-mac-arm64.dmg"), "Should delete older 2.8.0 dmg");
  assert.ok(deletedPaths.includes(".temp0123-Pi-Deepseek-0.2.5.1-mac-arm64.dmg"), "Should delete temp dmg");

  fs.mkdirSync(path.join(releaseDir, "Taosi-3.0.15-mac-arm64.app"));
  assert.equal(previousBuiltVersion("3.0.16", ["3.0.8"], tempDir), "3.0.15",
    "Untagged local builds must be retained ahead of older public releases");
  const localPlan = planRetention({ latestVersion: "3.0.16",
    previousVersion: previousBuiltVersion("3.0.16", ["3.0.8"], tempDir), desktopDir: tempDir });
  assert.ok(localPlan.toKeep.some((item) => item.path.endsWith("Taosi-3.0.15-mac-arm64.app")));
  assert.equal(previousBuiltVersion("3.0.15", ["3.0.8", "3.0.16"], tempDir), "3.0.8");
  const stale = path.join(releaseDir, "mac-arm64/Taosi.app");
  const latest = path.join(tempDir, "release-3.0.2-final/mac-arm64/Taosi.app");
  fs.mkdirSync(stale, { recursive: true });
  fs.mkdirSync(latest, { recursive: true });
  assert.equal(findBuiltMacApp("3.0.2", tempDir, (app) => app === latest ? "3.0.2" : "3.0.1"), latest);
  assert.equal(findBuiltMacApp("3.0.3", tempDir, () => "3.0.2"), null);
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log("manage-release-retention tests passed successfully.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
