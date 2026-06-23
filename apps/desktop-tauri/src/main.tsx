/**
 * Tauri renderer entry. Reuses the full Electron React renderer
 * (apps/desktop/src) unchanged, but first installs `window.piApp` via the
 * Tauri bridge shim so `useDesktopAppState`'s boot sees a populated bridge.
 *
 * The Electron entry (apps/desktop/src/main.tsx) additionally imports
 * `./dev-reload-hook`; that hook is electron-vite/HMR specific and is
 * intentionally skipped here.
 */
import React from "react";
import ReactDOM from "react-dom/client";

import App from "../../desktop/src/App";
import "../../desktop/src/styles.css";

import { installPiApp } from "./pi-app-shim";

async function boot(): Promise<void> {
  await installPiApp();

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void boot();
