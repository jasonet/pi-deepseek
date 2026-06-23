import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const here = path.dirname(fileURLToPath(import.meta.url));
// Reuse the desktop renderer's @pi-gui/* path mappings.
const pathsProject = path.resolve(here, "../desktop/tsconfig.paths.json");

export default defineConfig({
  root: "src",
  base: "./",
  plugins: [react(), tsconfigPaths({ projects: [pathsProject] })],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
