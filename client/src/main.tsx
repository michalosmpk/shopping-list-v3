import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./styles/global.scss";

// Ship the new app shell as soon as a redeploy lands. We don't show
// any "update available?" prompt: with `immediate: true` plus the
// skipWaiting/clientsClaim config in vite.config.ts, the new service
// worker takes over the next time the page loads and a single
// `location.reload()` swaps the user onto the new bundle.
//
// The `period` poll catches the case where the SPA stays open for a
// long time (e.g. a PWA pinned to the iPhone home screen) — every
// hour it re-checks /sw.js and triggers an update if the deploy
// happened while the tab was alive.
const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    setInterval(
      () => {
        registration.update().catch(() => {
          // network failure on a periodic poll is fine; we'll try
          // again next interval.
        });
      },
      60 * 60 * 1000
    );
  },
  onNeedRefresh() {
    // skipWaiting is on so calling updateSW() activates the new
    // worker, then reloads with the new bundle.
    void updateSW(true);
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
