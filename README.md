# Shopping List v3

An offline-first shopping list PWA with multi-list support, real user accounts (admin-managed), shareable per-list links with guest passwords, manual reordering, and a tiny Express BFF on top of a locally-hosted Supabase. Mobile-first; installs to your phone's home screen as a "real app."

## Stack

- **Client**: Vite + React + TypeScript + SCSS
  - PWA via `vite-plugin-pwa` (service worker + web app manifest, installable)
  - Local store: IndexedDB through [Dexie](https://dexie.org/)
  - Drag & drop reordering: `@dnd-kit` (touch-friendly)
- **Server**: Node.js + Express acting as a BFF (auth, admin, share-link auth)
- **Database / Auth**: locally-hosted [Supabase](https://supabase.com/docs/guides/local-development) (Postgres + GoTrue + Realtime)
- **Real users**: stored in `auth.users` + `public.profiles` with an `is_admin` flag
- **Guests**: BFF-signed JWT tokens scoped to a single list (no account)

## Features

- Real users — admins only; no public sign-up
- Admin panel (re-auth required) for adding/removing users and toggling admin
- Multi-list with drag-to-reorder for both lists and items
- Per-list shareable links (`/share/<token>`) gated by a guest password the owner sets
- Guests can edit (add/check/rename/reorder items) but can't delete the list or manage shares
- Fully usable offline:
  - All reads come from IndexedDB
  - All writes apply immediately and locally
  - New (un-synced) records show with reduced opacity
  - Compact sync chip in each header (status dot + spinner) with details on hover
  - Auto-sync on app start, focus, online event, debounced after writes; manual sync via tapping the chip
- Last-writer-wins conflict resolution by `updatedAt` per list and per item
- Swipe-left to delete on rows; deletes show a 7-second Undo toast (capped at 4 visible, scrollable beyond)

## Quick start

You need Docker (or OrbStack — this project uses it) for the local Supabase stack.

```bash
# 1. Install JS deps (uses npm workspaces).
npm install

# 2. Install the Supabase CLI (one of):
#    - macOS:   brew install supabase/tap/supabase
#    - all OS:  npm install -g supabase
#    - direct:  https://supabase.com/docs/guides/local-development/cli/getting-started

# 3. Boot the local Supabase stack (Docker required, takes ~30s the first time).
#    Migrations in supabase/migrations/ are applied automatically.
supabase start

# 4. Copy the printed values into a fresh .env file.
cp .env.example .env
#    Fill in: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
#    Set JWT_SECRET to any long random string.
#    Set ADMIN_BOOTSTRAP_NAME / ADMIN_BOOTSTRAP_PASSWORD if you want the
#    server to auto-create an initial admin on first run.

# 5. Start the dev servers (Express on :4000, Vite on :5173 with /api proxy).
npm run dev
```

Then open http://localhost:5173 and sign in with the bootstrap admin.

### Useful Supabase commands

```bash
supabase status                # show URLs, ports, keys
supabase stop                  # tear the stack down
supabase db reset              # drop & re-apply migrations (DESTRUCTIVE)
supabase studio                # opens http://localhost:54323
```

## Deployment (single host)

Drop the repo on a Linux box (or your Mac) with **Node 20+**, **npm**, and
**Docker** running, then it's a one-liner:

```bash
git clone <repo> shopping-list-v3 && cd shopping-list-v3
npm run prod                   # installs deps, boots Supabase, builds, starts BFF
```

That command is idempotent — re-run it after `git pull` and it'll rebuild and
restart only what's needed. It does, in order:

1. `npm install` (skipped if `node_modules/` already exists)
2. `supabase start` (skipped if the stack is already up — Docker required)
3. Pulls the API URL + anon/service-role keys from `supabase status` into `.env`
4. Generates a real `JWT_SECRET` on first run if the placeholder is still set
5. Builds the server (`tsc`) and the client (`vite build`)
6. Starts the Express BFF in the background via `nohup`, writing the pid to
   `logs/server.pid` and stdout/stderr to `logs/server.log`

After it's up, the BFF serves the SPA itself on `PORT` (default `4000`):

| URL                         | What                                                 |
| --------------------------- | ---------------------------------------------------- |
| `http://<host>:4000/`       | the SPA (login + lists)                              |
| `http://<host>:4000/api/*`  | BFF endpoints (used by the SPA, no separate origin)  |
| `http://<host>:54321`       | Supabase API (only the BFF talks to it directly)     |
| `http://<host>:54323`       | Supabase Studio (DB GUI — bind to localhost only!)   |

### Day-to-day commands

```bash
npm run prod          # start everything in the background
npm run prod:stop     # stop the BFF (Supabase keeps running)
npm run prod:restart  # stop + start (use after pulling new code)
npm run prod:status   # show BFF + Supabase status
npm run prod:logs     # tail -f logs/server.log
npm run supabase:stop # stop Supabase too if you really want everything down
```

Settings worth tweaking in `.env` for production:

- `PORT` — what port the BFF (and the SPA it serves) listens on.
- `CLIENT_ORIGIN` — comma-separated list of allowed origins for CORS.
  Defaults to `*` in prod since the SPA is same-origin; tighten this if you
  put the API on a different host.
- `ADMIN_REAUTH_TTL_SECONDS` — how long an admin's elevated session lasts
  (default 300 = 5 min). Bump it if you're tired of re-typing the password.
- Remove `ADMIN_BOOTSTRAP_NAME` / `ADMIN_BOOTSTRAP_PASSWORD` after the first
  successful boot — they only kick in when no admin exists yet.

### Putting it behind a reverse proxy

The BFF is a plain HTTP server, so you can front it with nginx / Caddy /
Traefik for TLS and let it forward to `127.0.0.1:4000`. Service workers (and
therefore PWA install) require HTTPS or localhost, so a proxy with a real
cert is the production-friendly path. Example nginx snippet:

```nginx
server {
  listen 443 ssl http2;
  server_name shop.example.com;
  ssl_certificate     /etc/letsencrypt/live/shop.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/shop.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

### Auto-start on boot, with nginx + HTTPS

For a "real" server (auto-start on reboot, restart on crash, TLS via
Let's Encrypt) there's a complete walkthrough plus copy-paste-ready
files in [`deploy/README.md`](./deploy/README.md):

- `deploy/systemd/shopping-list-supabase.service` — boots the local
  Supabase stack via Docker
- `deploy/systemd/shopping-list.service` — runs the BFF, depends on
  Supabase, restarts on crash
- `deploy/nginx/shopping-list.conf` — HTTP→HTTPS redirect + reverse
  proxy to `127.0.0.1:4000`

Use systemd *instead of* `npm run prod` so you don't have two
supervisors fighting over the port.

## URLs

- `/` — list overview (also where the **Admin** button shows up for admins)
- `/list/<id>` — a single list
- `/admin` — user management (admins only, requires fresh re-auth)
- `/share/<token>` — guest entry point for a shared list (gated by guest password)

`/list/<id>` and `/share/<token>` are stable deep links — bookmark or share them. The dev server and the bundled service worker both fall back to `index.html` for unknown paths. For static hosts, configure SPA fallback (Netlify/Vercel/Cloudflare Pages do it by default; for plain nginx add a rewrite to `/index.html`).

## Install as a mobile app

1. Deploy the client over HTTPS (Vercel, Netlify, Cloudflare Pages…) or use a tunnel for testing.
2. Open the URL in **Safari** (iOS) or **Chrome** (Android).
3. iOS: Share → "Add to Home Screen". Android: menu → "Install app".
4. Launch from the home screen — it opens full-screen, with offline support.

## Project layout

```
shopping-list-v3/
├── supabase/
│   ├── config.toml                # local stack config (`supabase start`)
│   └── migrations/                # SQL applied on `supabase start`
├── server/                        # Express BFF
│   └── src/
│       ├── env.ts                 # dotenv config
│       ├── auth.ts                # session middleware (user / guest / admin-elevated)
│       ├── lib/
│       │   ├── supabase.ts        # service-role + anon clients
│       │   ├── jwt.ts             # guest + admin-elevated tokens
│       │   ├── repo.ts            # lists/items reads + last-writer-wins merge
│       │   └── users.ts           # name <-> email mapping, profile CRUD
│       └── routes/
│           ├── auth.ts            # /api/auth (login, refresh, me, reauth-admin)
│           ├── sync.ts            # /api/sync (heartbeat, pull, push)
│           ├── admin.ts           # /api/admin/users
│           └── share.ts           # /api/share (owner config + guest auth)
├── client/                        # Vite + React + SCSS PWA
│   ├── public/icons/
│   └── src/
│       ├── api.ts                 # fetch wrapper, refresh-on-401, admin/guest tokens
│       ├── auth/                  # AuthProvider, GuestProvider, sessionRegistry
│       ├── db/                    # Dexie store + CRUD ops
│       ├── sync/                  # SyncProvider + sync engine
│       ├── components/            # Login, Lists, List, Admin, Share*, SyncChip, Toast…
│       ├── styles/
│       ├── App.tsx                # routes by path: lists / list / admin / share
│       └── main.tsx
├── package.json                   # workspaces + dev/build scripts
└── .env.example
```

## Sync model

- Every list and item has a stable client-generated `id` (UUID), an `updatedAt` timestamp (`Date.now()`), and a `deleted` flag (soft-delete).
- Locally, every record also has a `dirty` flag (>0 means "needs to be pushed").
- The sync engine:
  1. Collects all dirty rows.
  2. POSTs them to `/api/sync` (push).
  3. GETs `/api/sync` (pull).
  4. Merges server state into Dexie with last-writer-wins.
  5. Clears `dirty` only when the server confirms the same `updatedAt`.
- A `/api/sync/heartbeat` endpoint returns the per-session "version" (the max `updated_at_ms` over visible rows). The client polls it every 10 s while the tab is visible and triggers a full sync only when the version changes.

That's enough for personal & small-trust use. For multi-user concurrent editing you'd want CRDTs.

## Auth model

Three token types flow through the BFF:

| Token                  | Issued by      | Used for                        | Sent in              |
| ---------------------- | -------------- | ------------------------------- | -------------------- |
| Supabase access token  | Supabase Auth  | All authed user requests        | `Authorization`      |
| BFF guest token        | Express        | `/api/sync` while in `/share/`  | `Authorization`      |
| Admin-elevated token   | Express        | `/api/admin/*` only             | `X-Admin-Token`      |

Refresh: when an access token is close to expiring (or returns 401), the client transparently exchanges its refresh token for a new pair via `/api/auth/refresh`.

Admin elevation: tapping **Admin** prompts for the user's password; on success the BFF issues a 5-minute admin-elevated token that's required (in addition to the regular Authorization) on every `/api/admin/*` request.

Names instead of emails: users only ever type a short name (`alice`, `bob.42`). The BFF maps that to a synthetic email (`<name>@<EMAIL_DOMAIN>`) before calling Supabase Auth, so `auth.users.email` stays valid without exposing the concept to the UI.

## Notes

- Service-role key bypasses Row-Level Security; the BFF is the source of authority. RLS is enabled with no policies on every public table — defence-in-depth in case anyone ever connects with the anon key.
- Service workers require https or localhost — fine for development.
