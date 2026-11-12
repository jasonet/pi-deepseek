import { build as bundle } from "esbuild";
import { build as buildRenderer } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(root, "../..");
const output = join(root, "build");
mkdirSync(output, { recursive: true });
await buildRenderer({
  configFile: false, root: join(root, "src"), base: "./",
  plugins: [react(), tsconfigPaths({ projects: [join(repo, "apps/desktop/tsconfig.paths.json")] })],
  resolve: { alias: { electron: join(root, "src/renderer-host.ts") } },
  define: { "process.platform": '"darwin"', "process.versions": '{"host":"Pake","webview":"WKWebView"}', "process.env.PI_APP_DEV_RELOAD_MARKERS": '"0"' },
  build: { outDir: join(root, "dist"), emptyOutDir: true, target: "safari15", sourcemap: false },
});

const staged = join(repo, "apps/desktop-tauri/src-tauri/sidecar");
if (!existsSync(join(staged, "node"))) throw new Error("Run node apps/desktop-tauri/scripts/stage-runtime.mjs first");
const runtime = join(output, "resources/sidecar");
// This directory contains only this generator's runtime payload.
rmSync(join(output, "resources"), { recursive: true, force: true });
mkdirSync(runtime, { recursive: true });
for (const name of ["node", "node_modules", "fx"]) cpSync(join(staged, name), join(runtime, name), { recursive: true });
function prune(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) prune(file);
    else if (/\.(?:map|d\.[cm]?ts)$/.test(entry.name)) rmSync(file);
  }
}
prune(join(runtime, "node_modules"));
for (const name of ["trading", "providers"]) {
  cpSync(join(repo, "apps/desktop/resources", name), join(output, "resources", name), { recursive: true });
}
mkdirSync(join(output, "resources/extensions"), { recursive: true });
for (const name of readdirSync(join(repo, "apps/desktop/resources/extensions")).filter((name) => name.endsWith(".tgz"))) {
  cpSync(join(repo, "apps/desktop/resources/extensions", name), join(output, "resources/extensions", name));
}
await bundle({
  entryPoints: [join(root, "sidecar/server.ts")], bundle: true, platform: "node", format: "esm", target: "node22",
  tsconfig: join(repo, "apps/desktop/tsconfig.paths.json"),
  alias: { electron: join(root, "sidecar/host.ts") },
  external: ["@earendil-works/pi-coding-agent", "node-pty", "proper-lockfile", "yaml"],
  banner: { js: 'import { createRequire as __hostCreateRequire } from "node:module"; import { fileURLToPath as __hostFileURLToPath } from "node:url"; import { dirname as __hostDirname } from "node:path"; const require = __hostCreateRequire(import.meta.url); const __filename = __hostFileURLToPath(import.meta.url); const __dirname = __hostDirname(__filename);' },
  outfile: join(runtime, "server.mjs"), logLevel: "info",
});
