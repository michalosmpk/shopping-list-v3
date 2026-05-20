# AGENTS.md

Operating manual for AI coding agents (Claude, Codex, Cursor, etc.) working
on this repo. Optimized for: "I joined this codebase 5 minutes ago, what
do I need to know before I start editing?"

For human-oriented setup/deploy docs see `README.md` and `deploy/README.md`.
Don't duplicate them here.

---

## What this project is

Offline-first multi-list shopping app. Monorepo with two workspaces:

- `client/` — Vite + React + TypeScript + SCSS PWA. IndexedDB via Dexie is
  the source of truth on the client; the server is a sync peer, not a
  remote DB.
- `server/` — Express BFF in front of a locally-hosted Supabase stack
  (Postgres + GoTrue + Realtime). Never lets the browser talk to Supabase
  directly.

Deployed as a single Node process (`server/dist/index.js`) that serves
both `/api/*` and the built SPA from `client/dist/`. nginx in front for
TLS. systemd manages it on prod (`shopping-list.service`).

---

## Repo layout, in priority order for code spelunking

```
server/src/
  index.ts          # Express boot + static SPA + cache-control split
  env.ts            # all env vars; the only place that reads process.env
  auth.ts           # session middleware: user vs guest vs admin-elevated
  lib/
    supabase.ts     # service-role + anon Supabase clients (+ ws polyfill)
    jwt.ts          # signs/verifies BFF tokens (admin elevation, guests)
    repo.ts         # ALL list/item reads + last-writer-wins merge logic
    users.ts        # name <-> email mapping (Supabase auth uses email)
  routes/
    auth.ts         # /api/auth        login, refresh, me, reauth-admin
    sync.ts         # /api/sync        heartbeat, pull, push
    admin.ts        # /api/admin/users CRUD + promote/demote
    share.ts        # /api/share       owner config + guest password auth

client/src/
  main.tsx          # ReactDOM bootstrap + service-worker registration
  App.tsx           # path-based router shell (no react-router)
  router.ts         # tiny custom router (history API + listeners)
  api.ts            # fetch wrapper, auto refresh on 401, token plumbing
  types.ts          # ShoppingList, ShoppingItem, SyncListPayload
  auth/             # AuthProvider, GuestProvider, sessionRegistry, storage
  db/
    local.ts        # Dexie schema + resetLocalDb()
    operations.ts   # client CRUD (always sets dirty=1 on mutating writes)
  sync/
    SyncProvider.tsx# context that owns the engine instance + status
    engine.ts       # heartbeat / pull / push / merge / dedupe queue
  components/       # one file per screen or widget — see README "Project
                    # layout" for the per-file blurb
  styles/global.scss# everything; no per-component CSS modules

supabase/
  config.toml       # supabase start config (ports, auth provider knobs)
  migrations/       # applied on `supabase start` / `migration up`

deploy/             # systemd units + nginx site + Linux walkthrough
scripts/
  prod.sh           # idempotent local "start everything" launcher
  redeploy.sh       # prod redeploy: pull, install, build, restart, health
```

---

## Non-negotiable invariants

Break these and the app misbehaves in subtle, user-visible ways.

### Sync / data flow

- **The local Dexie store is the source of truth on the client.** All
  reads go through `db/local.ts`; all writes go through `db/operations.ts`
  which always sets `dirty: 1` and bumps `updatedAt = Date.now()`. The
  sync engine flushes the dirty rows; the UI never blocks on the network.
- **Merge is last-writer-wins by `updatedAt`** per record (list or item).
  Don't add fields that aren't safe under LWW (e.g. counters) without
  rethinking the merge.
- **`localOnly: true`** means "created on this device, never confirmed by
  the server yet." It drives the reduced-opacity row hint. It's cleared
  on first successful push *or* pull. Reordering and renaming must NOT
  set it — only fresh creates.
- **Server never trusts client `ownerId` / `isOwner` / `shared`** on
  push. Those are server-derived and re-attached on every response. See
  the comment in `client/src/types.ts` above `SyncListPayload`.
- **`resetLocalDb()` is required on every session switch** (login,
  logout, guest entry, admin elevation expiry). Different users must
  never see each other's cached data. `sessionRegistry` enforces this.

### Auth

- Three token types coexist:
  1. **User session** — Supabase-issued JWT (`access_token` +
     `refresh_token`). Stored in `localStorage` via `auth/storage.ts`.
  2. **Admin-elevated** — BFF-signed JWT with short TTL
     (`ADMIN_REAUTH_TTL_SECONDS`, default 300s). Required by every
     `/api/admin/*` endpoint. Issued by `POST /api/auth/reauth-admin`.
  3. **Guest** — BFF-signed JWT scoped to a single `list_id`, issued by
     `POST /api/share/auth/:token` after the guest password check.
- `server/src/auth.ts` parses all three. Don't bypass it — never read
  `Authorization` directly from a route handler.
- Admin-only routes must check `is_admin` AND require the elevation
  token. Just having an admin user-session isn't enough.
- No public registration. Users are created only via `/api/admin/users`
  or the `ADMIN_BOOTSTRAP_*` env vars (which auto-fire on cold start when
  no admin exists).

### PWA / caching

- Production Express splits cache headers in `server/src/index.ts`:
  - `/index.html`, `/sw.js`, `/workbox-*`, `/manifest.webmanifest` →
    `Cache-Control: no-cache, no-store, must-revalidate`
  - `/assets/*` (hashed bundle) → `public, max-age=31536000, immutable`
  - Keep this split. Caching `index.html` re-introduces the "redeploy
    didn't update the site" bug.
- Service worker uses `skipWaiting + clientsClaim + cleanupOutdatedCaches`
  in `client/vite.config.ts`. `main.tsx` registers it via
  `virtual:pwa-register` with `immediate: true` and a one-hour
  `registration.update()` poll. Don't replace this with a manual prompt
  flow without coordinating cache headers.
- `workbox.mode: "development"` in `vite.config.ts` is **load-bearing**.
  It disables a buggy terser-in-worker pass that intermittently crashes
  the build with `Unable to write the service worker file. Unfinished
  hook action(s) on exit: (terser) renderChunk`. The SW is 15 KB — not
  worth minifying.

### Build / deploy

- `*.tsbuildinfo` is gitignored. Don't commit it; `redeploy.sh` proactively
  `git rm --cached`s the two known ones if they sneak back in.
- `redeploy.sh` refuses to run as root and refuses on a dirty tree. Both
  guards are intentional — don't soften them.
- The Supabase Docker stack is never restarted on a code-only redeploy.
  User data lives in its volume; touching it risks data loss.

---

## Common task playbooks

### "Add a new field to lists or items"

1. Migration in `supabase/migrations/` — `ALTER TABLE lists ADD COLUMN …`.
2. Add the column to `DbList` / `DbItem` in `server/src/lib/repo.ts`.
3. Update `shapeWire()` (and the symmetric merge in `applyClientChanges`)
   so the field round-trips.
4. Add it to `ShoppingList` / `ShoppingItem` in `client/src/types.ts`.
5. Persist it from the server response in `client/src/sync/engine.ts`.
6. Bump the Dexie schema in `client/src/db/local.ts` (version + upgrade
   block). Test that existing users don't lose data on upgrade.
7. Wire UI in the relevant screen. Mutating writes go through
   `client/src/db/operations.ts` so `dirty` + `updatedAt` get set.
8. Apply the migration on prod via `npm run redeploy -- --migrate`.

### "Add a new API endpoint"

1. Pick the right router in `server/src/routes/`. Don't add a new top-level
   router unless the URL prefix really differs.
2. Use the existing session middleware (`auth.ts`); never read headers
   directly.
3. If admin-only, also require `req.adminElevation` (see other admin
   routes for the pattern).
4. Add a method to `client/src/api.ts` so the rest of the SPA goes
   through the same refresh-on-401 wrapper.
5. New error shapes: throw `api.HttpError` or shape `{ error, detail }`
   so existing UI error handling (`err.detail ?? Error (${err.status})`)
   keeps working.

### "Fix a UI bug" — quick checklist

- All styles in `client/src/styles/global.scss`. There's no per-component
  CSS. Use BEM-ish names matching the JSX classes.
- Modals: `.modal__backdrop` + `.modal`. Toasts must stay above modals
  (`.toasts` z-index is 1200; modal backdrop is 1100).
- Use the `useToast()` hook in `components/Toast.tsx` for non-blocking
  messages; never use `alert()` or `confirm()` (we removed the last
  ones; please don't bring them back). For deletes specifically: show a
  10s undo toast that calls the matching `restore*` operation.
- Drag-to-reorder uses `@dnd-kit` with
  `modifiers={[restrictToVerticalAxis, restrictToParentElement]}` in
  both `ListsScreen.tsx` and `ListScreen.tsx`. Keep both modifiers.

---

## Local development

```bash
supabase start          # one-time per session; needs Docker
npm install             # one-time per checkout
npm run dev             # Vite :5173 + Express :4000 with /api proxy
```

`npm run dev` is what you want 90% of the time. `npm run prod` and
`scripts/prod.sh` are for production-style local smoke-testing — they
build everything and run the Express process directly.

### Useful one-liners

```bash
npm run typecheck                # both workspaces, no emit
npm --workspace client run typecheck
npm --workspace server run typecheck
npm run build                    # tsc + vite build
npm run supabase:status
npm run supabase:reset           # DESTRUCTIVE — drops & re-applies migrations
```

### Database during dev

- Supabase Studio: <http://localhost:54323>
- Postgres direct: `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- Service-role key for ad-hoc REST: `grep SUPABASE_SERVICE_ROLE_KEY .env`
- Create a throwaway user via REST (see prior session transcripts for
  the exact `curl` to `/auth/v1/admin/users` + insert into `profiles`).

### Browser testing inside an agent session

The `cursor-ide-browser` MCP can drive a real Chromium. Lock → navigate
→ act → unlock. Don't trust clipboard APIs in that browser — the share
modal's Copy button intentionally falls back to a toast-with-the-URL on
failure, which is what triggers in the agent browser. That's not a bug.

---

## Things future agents have gotten wrong before

- **Adding a `confirm()` for delete** — we deliberately removed all
  blocking dialogs. Use undo toasts (`restoreList` / `restoreItem`).
- **Caching `index.html`** — even one hour breaks the entire redeploy
  story. The cache split in `server/src/index.ts` is intentional.
- **Skipping `localOnly` cleanup on the *pull* path** — created items
  must clear `localOnly` once the server echoes them back, otherwise
  they're permanently dimmed.
- **Setting `localOnly: true` on reorder/rename** — only fresh creates.
  Reordering a synced row must NOT dim it.
- **Trusting `req.user` on `/api/admin/*`** — also check
  `req.adminElevation`. Admin user-session alone isn't sufficient.
- **Calling `git push` without `-u origin <branch>`** on this repo —
  `main` doesn't have an upstream set; `git push origin main` works.
- **Editing `*.tsbuildinfo`** — they're build artifacts, gitignored. If
  one ever shows up in `git status`, the redeploy script will untrack it
  automatically.

---

## Style & conventions

- TypeScript everywhere, strict. Don't add `// @ts-ignore`; if you reach
  for it, the model is wrong, not the type.
- Comments explain *why*, not *what*. The codebase already has good
  examples — see `server/src/lib/repo.ts` and
  `client/src/sync/engine.ts`. Match that voice.
- No emojis in code or messages unless the user asks.
- Commit messages: imperative subject, optional explanatory body. Recent
  history uses "Auto-update PWA on redeploy" / "Stop tracking tsbuildinfo
  build artifacts" — match that.
- No new top-level dependencies without checking what's already there.
  Dexie / @dnd-kit / vite-plugin-pwa / express / ws / bcryptjs are
  already in. Adding e.g. react-router would be a big deal — the custom
  `router.ts` exists deliberately.
