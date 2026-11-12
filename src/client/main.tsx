import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { startOfflineSync } from "./offline-store.ts";
import { applyThemeColor, captureInstallPrompt, registerServiceWorker } from "./pwa.ts";
import "./tokens.css";
import "./styles.css";

captureInstallPrompt();
const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
applyThemeColor();
registerServiceWorker();
startOfflineSync();
