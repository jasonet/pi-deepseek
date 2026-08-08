import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = __dirname;
const pathsProject = path.resolve(projectRoot, "tsconfig.paths.json");
const devPort = Number(process.env.PI_APP_DEV_PORT ?? "5173");
export default defineConfig(({ command }) => {
  const cleanOutputs = command === "build";

  return {
    main: {
      plugins: [tsconfigPaths({ projects: [pathsProject] })],
      build: {
        outDir: "out/main",
        emptyOutDir: cleanOutputs,
        rollupOptions: {
          input: {
            main: path.resolve(projectRoot, "electron/main.ts"),
          },
        },
      },
    },
    preload: {
      plugins: [tsconfigPaths({ projects: [pathsProject] })],
      build: {
        outDir: "out/preload",
        emptyOutDir: cleanOutputs,
        rollupOptions: {
          input: {
            preload: path.resolve(projectRoot, "electron/preload.ts"),
          },
        },
      },
    },
    renderer: {
      root: projectRoot,
      base: "./",
      plugins: [react(), tsconfigPaths({ projects: [pathsProject] })],
      server: {
        port: devPort,
        strictPort: true,
      },
      build: {
        outDir: "out/renderer",
        emptyOutDir: true,
        target: "esnext",
        cssMinify: true,
        rollupOptions: {
          input: path.resolve(projectRoot, "index.html"),
          output: {
            manualChunks: {
              // React core + DOM (~130KB)
              "vendor-react": ["react", "react-dom"],
              // Markdown rendering (~230KB)
              "vendor-markdown": ["react-markdown", "remark-gfm"],
              // Syntax highlighting (~150KB)
              "vendor-highlight": ["highlight.js"],
              // xterm terminal (~280KB)
              "vendor-xterm": ["@xterm/xterm", "@xterm/addon-fit", "@xterm/addon-clipboard", "@xterm/addon-web-links"],
              // Shared workspace packages
              "vendor-pi-sdk": ["@pi-gui/pi-sdk-driver", "@pi-gui/session-driver", "@pi-gui/catalogs"],
            },
          },
        },
      },
    },
  };
});
