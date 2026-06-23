// Bundles the Node sidecar (sidecar/server.ts) into sidecar/dist/server.mjs.
// The real pi runtime (@earendil-works/pi-coding-agent, ESM-only) and node-pty
// stay external so they're loaded from the shipped node_modules at runtime.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

await build({
  entryPoints: [join(here, "server.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  tsconfig: join(repoRoot, "apps", "desktop", "tsconfig.paths.json"),
  external: ["@earendil-works/pi-coding-agent", "node-pty"],
  outfile: join(here, "dist", "server.mjs"),
  logLevel: "info",
});
