# Shopping List v3

An offline-first shopping list PWA with multi-list support, password auth, manual reordering, and a tiny Express + MongoDB sync backend. Mobile-first; installs to your phone's home screen as a "real app."

## Stack

- **Client**: Vite + React + TypeScript + SCSS
  - PWA via `vite-plugin-pwa` (service worker + web app manifest, installable)
  - Local store: IndexedDB through [Dexie](https://dexie.org/)
  - Drag & drop reordering: `@dnd-kit` (touch-friendly)
- **Server**: Node.js + Express + [lowdb](https://github.com/typicode/lowdb) (a tiny JSON-file DB — no daemon, no install)
- **Auth**: shared password from `.env`, stored client-side as a bearer token with a 365-day expiry

## Features

- Multiple lists, each with items (name + optional quantity)
- Manual reorder for both lists and items (drag handle, works on touch)
- Password-protected (single shared password, in `.env`)
- Token persisted in `localStorage` with 365-day expiry
- Fully usable offline:
  - All reads come from IndexedDB
  - All writes apply immediately, locally
  - Pending changes are visually faded (opacity 0.55)
  - A sticky sync bar shows online/offline + pending count + last sync
  - Manual "sync now" button on the bar
  - Auto-sync on: app start, focus, online event, debounced after writes
  - Auto-retry every 30s while there are pending changes or sync is failing
- Last-writer-wins conflict resolution by `updatedAt` per list and per item

## Quick start

```bash
# 1. Install everything (uses npm workspaces).
npm install

# 2. Copy env and edit it.
cp .env.example .env
# Then edit .env to set APP_PASSWORD.

# 3. Start dev servers (server on :4000, Vite on :5173 with /api proxy).
npm run dev
```

The server stores data in `data/shopping-list.json` (created on first run,
gitignored). Override the path via the `DATA_FILE` env var if you want.

Open http://localhost:5173 on your phone (same Wi-Fi) or desktop.

## Production build

```bash
npm run build
npm start          # serves the API
# Serve the built client (client/dist) with any static host, or behind the
# same domain as the API. Service workers require https or localhost.
```

## URLs

- `/` — list overview
- `/list/<id>` — a single list (the `id` is the list's UUID)

You can save/share/bookmark a `/list/<id>` URL — it's a stable deep link.
Vite's dev server and the bundled service worker both fall back to
`index.html` for unknown paths. If you deploy to a static host, make sure
it has SPA fallback configured (e.g. Netlify/Vercel/Cloudflare Pages do
this by default; for plain nginx/Apache add a rewrite to `/index.html`).

## Install as a mobile app

1. Deploy the client over HTTPS (Vercel, Netlify, Cloudflare Pages, etc.) or
   use a tunnel like Cloudflare Tunnel for testing.
2. Open the URL in **Safari** (iOS) or **Chrome** (Android).
3. iOS: Share → "Add to Home Screen". Android: menu → "Install app".
4. Launch from the home screen — it opens full-screen, with offline support.

## Project layout

```
shopping-list-v3/
├── server/                     # Express API + lowdb
│   ├── src/
│   │   ├── env.ts              # dotenv-loaded config (reads root .env)
│   │   ├── db.ts               # lowdb JSON-file store
│   │   ├── auth.ts             # bearer-token middleware
│   │   └── routes/
│   │       ├── auth.ts         # POST /api/auth/login
│   │       └── sync.ts         # GET/POST /api/sync
│   └── package.json
├── client/                     # Vite + React + SCSS PWA
│   ├── public/icons/           # SVG manifest icons
│   ├── src/
│   │   ├── api.ts              # fetch wrapper
│   │   ├── auth/               # AuthProvider + token storage
│   │   ├── db/                 # Dexie store + CRUD ops
│   │   ├── sync/               # SyncProvider + sync engine
│   │   ├── components/         # Login, Lists, List, SyncBar, Icons
│   │   ├── styles/             # SCSS tokens + global
│   │   ├── App.tsx
│   │   └── main.tsx
│   └── vite.config.ts
├── package.json                # workspaces + dev/build scripts
└── .env.example
```

## Sync model

- Every list and item has a stable client-generated `id` (UUID), an
  `updatedAt` timestamp (`Date.now()`), and a `deleted` flag (soft-delete
  for sync).
- Locally, every record also has a `dirty` flag (>0 means "needs to be
  pushed").
- The sync engine:
  1. Collects all dirty rows.
  2. POSTs them to `/api/sync` (push).
  3. GETs `/api/sync?since=<lastPullAt>` (pull).
  4. Merges server state into Dexie with last-writer-wins.
  5. Clears dirty flags only when the server confirms the same `updatedAt`.

That's enough for a single-user / small-trust app like this. For
multi-user concurrent editing you'd want CRDTs, but that's overkill here.

## Notes

- The "token" is just the password itself, sent as `Authorization: Bearer <password>`.
  This is fine for a single shared password and keeps everything trivial.
  Swap for JWT/sessions if you ever need real users.
- The service worker caches only the app shell; API calls go through the
  network so we never serve stale list data. Offline persistence comes
  from IndexedDB, which we control directly.
