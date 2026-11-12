import React from "react";
import ReactDOM from "react-dom/client";
import "../../desktop/src/styles.css";
import { initializeBridge } from "./renderer-host";
import { RenderErrorBoundary } from "../../desktop/src/render-error-boundary";

async function boot() {
  await initializeBridge();
  await import("../../desktop/electron/preload");
  const { default: App } = await import("../../desktop/src/App");
  ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><RenderErrorBoundary><App /></RenderErrorBoundary></React.StrictMode>);
}

void boot().catch((error) => {
  document.getElementById("root")!.textContent = `Taosi could not start: ${String(error)}`;
});
