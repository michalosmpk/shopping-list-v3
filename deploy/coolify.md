# Deploy on Coolify (simplest path)

Two resources. About 10 minutes. Coolify handles HTTPS + restarts.

## 1. Supabase (one-click)

1. Coolify → your project → **+ New** → **Service** → **Supabase**
2. Deploy and wait until healthy
3. Open **Environment Variables** and copy (Coolify's names → our names):
   - Kong / API URL (`SERVICE_URL_SUPABASEKONG…`) → `SUPABASE_URL`
   - `SERVICE_SUPABASEANON_KEY` → `SUPABASE_ANON_KEY`
   - `SERVICE_SUPABASESERVICE_KEY` → `SUPABASE_SERVICE_ROLE_KEY`
     (same key — Coolify drops the `_ROLE` from the name)
4. Open Supabase Studio (Coolify shows the link) → **SQL Editor**
5. Paste all of [`schema.sql`](./schema.sql) → **Run** once

## 2. App (this repo)

1. **+ New** → **Application** → your Git repo
2. Build pack: **Docker Compose** (or **Dockerfile**)
   - Compose file: `docker-compose.yml` (repo root)
   - Or Dockerfile path: `/Dockerfile`
3. Port: `4000`
4. Domain: set your domain (HTTPS is automatic — needed for the PWA)
5. Environment variables:

```
SUPABASE_URL=<kong url from step 1 — prefer the internal http://… URL if Coolify shows one>
SUPABASE_ANON_KEY=<from step 1>
SUPABASE_SERVICE_ROLE_KEY=<from step 1>
JWT_SECRET=<long random string, e.g. openssl rand -hex 32>
CLIENT_ORIGIN=*
PORT=4000
NODE_ENV=production
ADMIN_BOOTSTRAP_NAME=admin
ADMIN_BOOTSTRAP_PASSWORD=<strong password>
```

6. Enable **Connect to Predefined Network** on the app (so it can reach Supabase)
7. Deploy

## 3. Smoke test

```bash
curl -sf https://YOUR_DOMAIN/api/health
# {"ok":true,"db":true,...}
```

Open the site → log in as `admin` / your bootstrap password → create real users in Admin → remove `ADMIN_BOOTSTRAP_*` from Coolify env and redeploy.

## Updates later

Push to the tracked branch (or click **Redeploy**). Coolify rebuilds the image. Supabase data stays put — never redeploy Supabase for an app-only change.

## If `/api/health` says `"db":false`

- App and Supabase must share a network (**Connect to Predefined Network**)
- `SUPABASE_URL` must be reachable from the app container (internal hostname, not `localhost`)
- Confirm `schema.sql` was applied
