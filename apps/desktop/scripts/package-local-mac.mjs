import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") throw new Error("Local macOS packaging requires macOS.");
const desktopDir = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const identities = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" });
const developmentIdentities = [...identities.matchAll(/"(Apple Development: [^"]+)"/g)].map((match) => match[1]);
const selected = process.env.TAOSI_LOCAL_SIGNING_IDENTITY?.trim()
  || (developmentIdentities.length === 1 ? developmentIdentities[0] : undefined);
if (!selected || !developmentIdentities.includes(selected)) {
  throw new Error("Select an installed Apple Development identity with TAOSI_LOCAL_SIGNING_IDENTITY. Local builds never fall back to ad-hoc signing.");
}
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
console.log(`Local development build: ${selected}. Keep this identity for subsequent local upgrades.`);
execFileSync(process.execPath, [
  require.resolve("electron-builder/cli.js"),
  "--mac", "--dir", `--${process.arch}`, "--publish", "never",
  `-c.mac.identity=${selected}`, "-c.forceCodeSigning=true",
  `-c.directories.output=release-${version}-local-dev`,
], { cwd: desktopDir, stdio: "inherit" });
