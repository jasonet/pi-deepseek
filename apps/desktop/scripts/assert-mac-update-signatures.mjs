import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appPaths = process.argv.slice(2);
const apps = appPaths.length > 0
  ? appPaths
  : ["release/mac/Taosi.app", "release/mac-arm64/Taosi.app"];
const expectedTeamId = process.env.TAOSI_EXPECTED_MAC_TEAM_ID?.trim();

function runCodeSign(args) {
  const result = spawnSync("codesign", args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`codesign ${args[0]} failed for ${args.at(-1)}: ${result.stderr || result.error?.message || result.stdout}`);
  }
  return `${result.stdout}${result.stderr}`;
}

function inspectApp(appPath) {
  runCodeSign(["--verify", "--deep", "--strict", "--verbose=2", appPath]);
  const details = runCodeSign(["--display", "--verbose=4", appPath]);
  if (/^Signature=adhoc$/m.test(details)) {
    throw new Error(`${appPath} is ad-hoc signed; ShipIt cannot update it across versions.`);
  }
  if (!/^Authority=Developer ID Application: .+$/m.test(details)) {
    throw new Error(`${appPath} is not signed with a Developer ID Application certificate.`);
  }
  const teamId = /^TeamIdentifier=([A-Z0-9]+)$/m.exec(details)?.[1];
  if (!teamId) {
    throw new Error(`${appPath} has no Apple Team ID.`);
  }
  return teamId;
}

if (process.platform !== "darwin") {
  throw new Error("macOS update signatures must be checked on macOS.");
}
if (!expectedTeamId) {
  throw new Error("Set TAOSI_EXPECTED_MAC_TEAM_ID to the stable Developer ID team's ID.");
}

for (const app of apps) {
  const appPath = path.resolve(desktopDir, app);
  const teamId = inspectApp(appPath);
  if (teamId !== expectedTeamId) {
    throw new Error(`${appPath} has Team ID ${teamId}; expected ${expectedTeamId}. Existing clients cannot auto-update across teams.`);
  }
  console.log(`[mac-update-signature] ${appPath}: Developer ID Application, Team ${teamId}`);
}
