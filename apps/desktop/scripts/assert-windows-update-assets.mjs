import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const releaseDir = path.resolve(scriptDir, "..", "release");
const expectedVersion = process.env.PI_APP_RELEASE_VERSION?.trim();
const feedPath = path.join(releaseDir, "latest.yml");

if (!expectedVersion) {
  throw new Error("PI_APP_RELEASE_VERSION is required.");
}
if (!existsSync(feedPath)) {
  throw new Error(`Windows update feed is missing: ${feedPath}`);
}

const feed = YAML.parse(readFileSync(feedPath, "utf8"));
if (String(feed?.version) !== expectedVersion) {
  throw new Error(`latest.yml version is ${String(feed?.version)}, expected ${expectedVersion}.`);
}

const expectedSetupName = `Taosi-${expectedVersion}-win-x64-setup.exe`;
if (feed?.path !== expectedSetupName) {
  throw new Error(`latest.yml path must target ${expectedSetupName}, received ${String(feed?.path)}.`);
}

const setupRecord = Array.isArray(feed?.files)
  ? feed.files.find((file) => file?.url === expectedSetupName)
  : undefined;
if (!setupRecord?.sha512 || !Number.isFinite(setupRecord?.size) || setupRecord.size <= 0) {
  throw new Error(`latest.yml is missing a valid files entry for ${expectedSetupName}.`);
}

const setupPath = path.join(releaseDir, expectedSetupName);
const blockmapPath = `${setupPath}.blockmap`;
for (const requiredPath of [setupPath, blockmapPath]) {
  if (!existsSync(requiredPath) || statSync(requiredPath).size <= 0) {
    throw new Error(`Required Windows updater asset is missing or empty: ${requiredPath}`);
  }
}
if (statSync(setupPath).size !== setupRecord.size) {
  throw new Error(`Setup size does not match latest.yml for ${expectedSetupName}.`);
}

console.log(JSON.stringify({
  ok: true,
  version: expectedVersion,
  feed: path.basename(feedPath),
  installer: expectedSetupName,
  blockmap: path.basename(blockmapPath),
}, null, 2));
