import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const releaseDir = path.resolve(scriptDir, "..", "release");
const rootPkg = JSON.parse(readFileSync(path.resolve(scriptDir, "../../../package.json"), "utf8"));
const expectedVersion = process.env.PI_APP_RELEASE_VERSION?.trim() || rootPkg.version;
const feedPath = path.join(releaseDir, "latest-mac.yml");

if (!expectedVersion) {
  throw new Error("PI_APP_RELEASE_VERSION or package.json version is required.");
}
if (!existsSync(feedPath)) {
  throw new Error(`macOS update feed is missing: ${feedPath}`);
}

const feed = YAML.parse(readFileSync(feedPath, "utf8"));
if (String(feed?.version) !== expectedVersion) {
  throw new Error(`latest-mac.yml version is ${String(feed?.version)}, expected ${expectedVersion}.`);
}

if (!Array.isArray(feed?.files) || feed.files.length === 0) {
  throw new Error(`latest-mac.yml has no files entry.`);
}

for (const fileRecord of feed.files) {
  if (!fileRecord?.url || !fileRecord?.sha512 || !Number.isFinite(fileRecord?.size) || fileRecord.size <= 0) {
    throw new Error(`latest-mac.yml has invalid files entry: ${JSON.stringify(fileRecord)}`);
  }
  const assetPath = path.join(releaseDir, fileRecord.url);
  if (!existsSync(assetPath) || statSync(assetPath).size !== fileRecord.size) {
    throw new Error(`Asset ${fileRecord.url} missing or size mismatch on disk.`);
  }
}

console.log(JSON.stringify({
  ok: true,
  version: expectedVersion,
  feed: path.basename(feedPath),
  files: feed.files.map((f) => f.url),
}, null, 2));
