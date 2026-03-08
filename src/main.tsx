import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n";
import App from "./App";

// Wait for Tauri IPC bridge before mounting React.
// The webview can load before __TAURI_INTERNALS__ is injected.
function waitForTauri(maxMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).__TAURI_INTERNALS__) {
      resolve();
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => {
      if ((window as any).__TAURI_INTERNALS__) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - start > maxMs) {
        clearInterval(interval);
        reject(new Error("Tauri IPC bridge not available"));
      }
    }, 20);
  });
}

waitForTauri()
  .then(() => {
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  })
  .catch((e) => {
    console.error("Failed to initialize Tauri:", e);
  });
