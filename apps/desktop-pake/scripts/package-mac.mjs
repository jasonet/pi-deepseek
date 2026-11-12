import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(root, "../..");
const pake = process.env.PAKE_SOURCE_DIR ?? resolve(repo, "../Pake");
const template = join(root, "build/pake-template");
const version = JSON.parse(readFileSync(join(root, "package.json"))).version;
const run = (command, args, options = {}) => execFileSync(command, args, { stdio: "inherit", ...options });
function replaceOnce(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error(`Pake integration anchor changed: ${anchor}`);
  return source.replace(anchor, replacement);
}
if (process.platform !== "darwin") throw new Error("This comparison build targets macOS");
run("pnpm", ["run", "cli:build"], { cwd: pake });
run("node", [join(repo, "apps/desktop/scripts/build-notification-status-helper.mjs")]);
run("node", [join(root, "scripts/build.mjs")]);
mkdirSync(template, { recursive: true });
for (const name of ["package.json", "pnpm-lock.yaml", "dist/cli.js", "LICENSE", "LICENSE-EXCEPTION"]) {
  mkdirSync(dirname(join(template, name)), { recursive: true });
  cpSync(join(pake, name), join(template, name));
}
cpSync(join(pake, "src-tauri"), join(template, "src-tauri"), {
  recursive: true,
  filter: (file) => !["target", ".pake", "gen"].includes(file.slice(join(pake, "src-tauri").length + 1).split("/")[0]),
});
if (!existsSync(join(template, "node_modules"))) symlinkSync(join(pake, "node_modules"), join(template, "node_modules"), "dir");
const cargoFile = join(template, "src-tauri/Cargo.toml");
writeFileSync(cargoFile, replaceOnce(readFileSync(cargoFile, "utf8"), "[dependencies]", `[dependencies]\ntauri-plugin-taosi = { path = ${JSON.stringify(join(root, "native"))} }\ntauri-plugin-dialog = "2"`));
const lib = join(template, "src-tauri/src/lib.rs");
writeFileSync(lib, replaceOnce(readFileSync(lib, "utf8"), ".plugin(window_state_plugin)", ".plugin(window_state_plugin)\n        .plugin(tauri_plugin_taosi::init())\n        .plugin(tauri_plugin_dialog::init())"));
const menu = join(template, "src-tauri/src/app/menu.rs");
const menuSource = readFileSync(menu, "utf8");
const menuStart = menuSource.indexOf('    let pake_version = env!("CARGO_PKG_VERSION");');
const menuEnd = menuSource.indexOf("\nfn app_menu", menuStart);
if (menuStart < 0 || menuEnd < 0) throw new Error("Pake menu entry changed; update the integration patch");
writeFileSync(menu, menuSource.slice(0, menuStart) + "    tauri_plugin_taosi::install_menu(app)\n}\n" + menuSource.slice(menuEnd));
const capability = join(template, "src-tauri/capabilities/default.json");
const config = JSON.parse(readFileSync(capability));
config.permissions.push("taosi:default", "core:default", "core:window:allow-set-theme", "core:window:allow-show", "core:window:allow-set-focus", "core:window:allow-unminimize", "dialog:allow-open", "dialog:allow-save", "dialog:allow-message", "opener:allow-open-url", "opener:allow-open-path");
writeFileSync(capability, JSON.stringify(config, null, 2));
cpSync(join(repo, "apps/desktop/resources/icon.icns"), join(template, "src-tauri/icons/icon.icns"));
const output = join(root, "release", version);
mkdirSync(output, { recursive: true });
const result = spawnSync("node", [join(template, "dist/cli.js"), join(root, "dist"), "--name", "Taosi-Pake", "--identifier", "com.pi-deepseek.pake", "--app-version", version, "--width", "1480", "--height", "980", "--min-width", "1000", "--min-height", "700", "--targets", "app", "--hide-title-bar", "--disabled-web-shortcuts", "--json"], {
  cwd: output, encoding: "utf8", maxBuffer: 50 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"],
  env: { ...process.env, CARGO_TARGET_DIR: join(root, "build/cargo-target") },
});
process.stderr.write(result.stderr ?? "");
writeFileSync(join(output, "pake-result.json"), result.stdout ?? "");
if (result.status !== 0) throw new Error(`Pake failed (${result.status}): ${result.stdout}`);
const report = JSON.parse(result.stdout);
const app = report.outputs.find((entry) => entry.format === "app")?.path;
if (!app) throw new Error("Pake did not return a macOS application bundle");
cpSync(join(root, "build/resources"), join(app, "Contents/Resources"), { recursive: true });
for (const name of ["pi-deepseek-notification-status-helper", "pi-deepseek-permission-helper"]) {
  cpSync(join(repo, "apps/desktop/build/native", name), join(app, "Contents/MacOS", name));
}
for (const name of ["LICENSE", "LICENSE-EXCEPTION"]) cpSync(join(pake, name), join(app, "Contents/Resources", `PAKE-${name}`));
run("codesign", ["--force", "--deep", "--sign", "-", app]);
const zip = join(output, `Taosi-Pake-${version}-darwin-${process.arch}.zip`);
run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, zip]);
const manifest = { version, url: `https://github.com/jasonet/pi-deepseek/releases/download/v${version}/${zip.split("/").at(-1)}`, sha256: createHash("sha256").update(readFileSync(zip)).digest("hex") };
writeFileSync(join(output, `latest-pake-${process.arch}.json`), JSON.stringify(manifest, null, 2) + "\n");
run("node", [join(repo, "scripts/manage-release-retention.mjs"), "--apply"]);
console.log(JSON.stringify({ app, zip, pakeVersion: JSON.parse(readFileSync(join(pake, "package.json"))).version }, null, 2));
