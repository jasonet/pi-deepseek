import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const releaseDir = path.join(rootDir, "apps", "desktop", "release");
const rootPkg = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));
const version = process.env.PI_APP_RELEASE_VERSION?.trim() || rootPkg.version;

if (!existsSync(releaseDir)) {
  console.warn(`[mac-update-feed] Release directory not found: ${releaseDir}`);
  process.exit(0);
}

const entries = readdirSync(releaseDir);
const zipFiles = entries.filter(
  (name) => name.startsWith(`Taosi-${version}-mac-`) && name.endsWith(".zip")
);

if (zipFiles.length === 0) {
  console.warn(`[mac-update-feed] No Taosi-${version}-mac-*.zip found in ${releaseDir}`);
  process.exit(0);
}

const files = [];
for (const zipName of zipFiles) {
  const fullPath = path.join(releaseDir, zipName);
  const data = readFileSync(fullPath);
  const size = statSync(fullPath).size;
  const sha512 = createHash("sha512").update(data).digest("base64");
  files.push({
    url: zipName,
    sha512,
    size,
  });
}

const primaryZip = zipFiles.find((z) => z.includes("arm64")) || zipFiles[0];
const primaryRecord = files.find((f) => f.url === primaryZip);

const feed = {
  version,
  files,
  path: primaryZip,
  sha512: primaryRecord.sha512,
  releaseDate: new Date().toISOString(),
};

const feedPath = path.join(releaseDir, "latest-mac.yml");
writeFileSync(feedPath, YAML.stringify(feed), "utf8");
console.log(`[mac-update-feed] Successfully generated ${feedPath} for v${version} with ${files.length} artifact(s).`);
