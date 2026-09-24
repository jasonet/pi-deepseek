import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { RenderErrorBoundary } from "./render-error-boundary";
import "./dev-reload-hook";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RenderErrorBoundary><App /></RenderErrorBoundary>
  </React.StrictMode>,
);
