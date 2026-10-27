const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const [source, home, resources, parentOrigin = "file"] = process.argv.slice(2);
if (!source || !home || !resources) throw new Error("Missing Trading profile paths");
const runtime = require(path.join(source, "desktop/src/runtime.cjs"));
const payload = path.join(source, "desktop/resources/runtime");
const profile = path.join(home, "profiles/trading-web");
const ownership = path.join(profile, ".taosi-managed.json");
if (fs.existsSync(profile) && !fs.existsSync(ownership)) {
  throw new Error("Trading profile is not Taosi-managed; refusing to modify it.");
}
// A fresh Taosi profile must not import legacy Trading data from ~/.dsh.
fs.mkdirSync(home, { recursive: true, mode: 0o700 });
try {
  fs.writeFileSync(path.join(home, ".legacy-home-migrated.json"), JSON.stringify({
    to: home, copied: [], skipped: [], reason: "Taosi isolated profile", at: new Date().toISOString(),
  }) + "\n", { flag: "wx", mode: 0o600 });
} catch (error) { if (error.code !== "EEXIST") throw error; }
const stamp = runtime.runtimeSeedStamp(runtime.readStampFile(path.join(payload, "VERSION.json")));
const action = runtime.profileAction(profile, stamp);
if (action !== "leave") {
  fs.mkdirSync(path.dirname(profile), { recursive: true, mode: 0o700 });
  const staged = fs.mkdtempSync(path.join(path.dirname(profile), ".taosi-profile-"));
  if (action === "reseed") fs.cpSync(profile, staged, { recursive: true });
  runtime.applyProfileSeed(path.join(payload, "profile-trading"), staged, action, stamp);
  fs.writeFileSync(path.join(staged, ".taosi-managed.json"), JSON.stringify({ owner: "taosi", revision: 1 }) + "\n", { mode: 0o600 });
  if (action === "reseed") {
    const backup = `${profile}-backup-${Date.now()}`;
    fs.renameSync(profile, backup);
    try { fs.renameSync(staged, profile); } catch (error) { fs.renameSync(backup, profile); throw error; }
  } else fs.renameSync(staged, profile);
}
runtime.normalizeProfileCohort(profile, path.join(payload, "host/node_modules"), { log: console.log });

// This companion is app-owned; the user's settings and trading packages stay untouched.
const bridge = path.join(resources, "bridge");
const target = path.join(profile, "node_modules/@taosi/dsh-trading-bridge");
fs.mkdirSync(target, { recursive: true });
fs.cpSync(bridge, target, { recursive: true });
const client = path.join(target, "client.js");
fs.writeFileSync(client, fs.readFileSync(client, "utf8").replace('"__TAOSI_PARENT_ORIGIN__"', JSON.stringify(parentOrigin)));
const patch = path.join(target, "cordis.patch.yml");
fs.writeFileSync(patch, fs.readFileSync(patch, "utf8").replace('"__TAOSI_RESEARCH_ROOT__"', JSON.stringify(path.join(home, "research"))));
const vendor = path.join(profile, "vendor");
fs.mkdirSync(vendor, { recursive: true });
const stage = fs.mkdtempSync(path.join(profile, ".taosi-bridge-"));
try {
  fs.cpSync(target, path.join(stage, "package"), { recursive: true });
  execFileSync("tar", ["-czf", path.join(vendor, "taosi-dsh-trading-bridge-1.0.0.tgz"), "-C", stage, "package"]);
} finally { fs.rmSync(stage, { recursive: true, force: true }); }
const manifestPath = path.join(profile, "package.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.dependencies["@taosi/dsh-trading-bridge"] = "file:./vendor/taosi-dsh-trading-bridge-1.0.0.tgz";
if (!manifest.dsh.profile.bundles.includes("@taosi/dsh-trading-bridge")) manifest.dsh.profile.bundles.push("@taosi/dsh-trading-bridge");
const tempManifest = `${manifestPath}.${process.pid}.tmp`;
fs.writeFileSync(tempManifest, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
fs.renameSync(tempManifest, manifestPath);
console.log("Taosi Trading profile ready; live trading remains disabled by default.");
