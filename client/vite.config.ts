import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // autoUpdate + skipWaiting + clientsClaim is the "no manual prompt,
      // new bundle wins on next page load" combo. Without skipWaiting the
      // new worker would stay in the `waiting` state until every existing
      // tab is closed, which on a PWA installed to home screen basically
      // means "never" — users who never close the app would stay pinned
      // to the old bundle indefinitely after a deploy.
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      workbox: {
        // workbox-build's default `mode: 'production'` pipes sw.js
        // through terser in a worker thread that intermittently exits
        // before its renderChunk hook resolves — surfacing as
        // `Unable to write the service worker file. Unfinished hook
        // action(s) on exit: (terser) renderChunk`. The SW is ~15 KB
        // of generated boilerplate so we don't actually need it
        // minified; skipping the terser pass eliminates the flaky
        // worker entirely.
        mode: "development",
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // We never want to serve stale API JSON from the SW — local Dexie
        // store is the source of truth offline. Only cache app shell.
        navigateFallback: "/index.html",
        // Ignore version query strings in navigation requests so a hard
        // reload like /?v=2 still hits the precached shell.
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
          },
        ],
      },
      manifest: {
        name: "Shopping List",
        short_name: "Lists",
        description: "Offline-first shopping lists.",
        theme_color: "#0b1220",
        background_color: "#0b1220",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "/icons/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "/icons/icon-maskable.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  css: {
    preprocessorOptions: {
      scss: { api: "modern-compiler" },
    },
  },
});
