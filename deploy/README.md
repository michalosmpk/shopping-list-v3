# Linux deployment (systemd + nginx)

Single-host production setup for shopping-list-v3:

- **systemd** auto-starts the local Supabase stack and the Express BFF on
  boot, restarts the BFF if it crashes
- **nginx** terminates TLS and reverse-proxies to the BFF on `127.0.0.1:4000`
- **certbot** handles Let's Encrypt issuance + renewal

Tested on Ubuntu 22.04 / 24.04. Should work on any Debian-family distro;
adjust paths slightly for RHEL/Alpine.

---

## 0. Prerequisites

A Linux box with:

- a public IPv4 (or v6) and a domain whose A/AAAA record points at it
- ports `80` and `443` open in your firewall (and **only** those externally —
  see "Lock down Supabase" below)
- root or sudo access

## 1. Install system packages

```bash
sudo apt update
sudo apt install -y git curl ca-certificates nginx certbot python3-certbot-nginx

# Docker (Supabase needs it)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"     # log out + back in for group to take effect

# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

node -v && npm -v && docker -v       # sanity check
```

## 2. Clone the repo

Pick a stable install directory. The systemd unit examples assume
`/srv/shopping-list-v3`, but anything works as long as the user running
the unit owns it.

```bash
sudo mkdir -p /srv && sudo chown "$USER" /srv
git clone <your-repo-url> /srv/shopping-list-v3
cd /srv/shopping-list-v3
```

## 3. Pre-fill `.env` with your bootstrap admin

```bash
cp .env.example .env
$EDITOR .env
# set:
#   ADMIN_BOOTSTRAP_NAME=admin
#   ADMIN_BOOTSTRAP_PASSWORD=<a strong password — you'll log in once with this>
# leave SUPABASE_* and JWT_SECRET as-is, the next step fills them in.
```

## 4. First-run: install, build, populate Supabase keys

`npm run prod` is idempotent and does everything: installs deps, boots
Supabase, syncs the keys into `.env`, builds server + client, then starts
the BFF in the background via `nohup`.

```bash
npm run prod
```

Verify it's reachable locally before bringing in nginx:

```bash
curl -sf http://127.0.0.1:4000/api/health && echo
# {"ok":true,"db":true,...}
```

Now stop the nohup-supervised BFF — systemd will manage it from here on:

```bash
npm run prod:stop
```

> Supabase keeps running. The systemd unit below also brings it up on
> boot, but starting it once now means the keys we just wrote into `.env`
> are correct.

## 5. Install the systemd units

The unit files in `deploy/systemd/` use `<USER>` and `<INSTALL_DIR>`
placeholders. Substitute them at install time and copy into place:

```bash
USER_=$(id -un)
INSTALL_=/srv/shopping-list-v3

for f in shopping-list-supabase.service shopping-list.service; do
  sed -e "s|<USER>|$USER_|g" -e "s|<INSTALL_DIR>|$INSTALL_|g" \
    "deploy/systemd/$f" | sudo tee "/etc/systemd/system/$f" >/dev/null
done

sudo systemctl daemon-reload
sudo systemctl enable --now shopping-list-supabase shopping-list

systemctl status shopping-list --no-pager
journalctl -u shopping-list -f                 # Ctrl-C to stop tailing
```

The BFF should now survive reboots, restart on crash, and follow the
Supabase unit on `sudo systemctl restart shopping-list-supabase`.

## 6. nginx site

```bash
DOMAIN=shop.example.com    # ← your real domain

sed "s|<DOMAIN>|$DOMAIN|g" deploy/nginx/shopping-list.conf \
  | sudo tee /etc/nginx/sites-available/shopping-list >/dev/null
sudo ln -sf /etc/nginx/sites-available/shopping-list \
            /etc/nginx/sites-enabled/shopping-list

# Optional: drop the default "Welcome to nginx" site so it doesn't shadow ours.
sudo rm -f /etc/nginx/sites-enabled/default

sudo nginx -t && sudo systemctl reload nginx
```

## 7. TLS via Let's Encrypt

`certbot --nginx` issues the cert, edits the nginx file in place to point
at it, and adds an automatic renewal timer.

```bash
sudo certbot --nginx -d "$DOMAIN" --redirect --agree-tos -m you@example.com
sudo systemctl reload nginx
```

Test it:

```bash
curl -sf "https://$DOMAIN/api/health" && echo
```

Then open `https://$DOMAIN` in a browser, log in with the bootstrap admin,
and create real users via the Admin panel.

## 8. After the first login: drop the bootstrap creds

They're only needed when no admin exists yet. Leaving them in `.env` is
harmless but messy.

```bash
sed -i '/^ADMIN_BOOTSTRAP_/d' .env
sudo systemctl restart shopping-list
```

---

## Update flow

The repo ships a `scripts/redeploy.sh` (also available as `npm run
redeploy`) that handles the whole pull → install → build → restart
cycle without ever touching `.env` or the Supabase Docker volume:

```bash
cd /srv/shopping-list-v3
npm run redeploy
```

What it does, in order:

1. refuses to run as root, refuses on a dirty working tree
2. `git fetch && git pull --ff-only` and prints the list of new commits
3. `npm ci` (reproducible install from the lockfile)
4. `npm run build` — clears `client/node_modules/.vite` first to dodge a
   known stale-cache crash from `vite-plugin-pwa`
5. `sudo systemctl restart shopping-list` (or falls back to
   `scripts/prod.sh restart` on hosts without the systemd unit)
6. polls `http://127.0.0.1:4000/api/health` for up to 30 s; on failure
   it dumps the last 30 lines of `journalctl -u shopping-list` and
   exits non-zero

The Supabase stack stays up across deploys — only the BFF restarts
(~1 s of downtime). Your data is in a Docker volume that is never
touched.

Useful flags:

```bash
npm run redeploy -- --no-build       # config-only restart, skips install + build
npm run redeploy -- --no-pull        # deploy whatever is already on disk
npm run redeploy -- --migrate        # also run `supabase migration up` for new SQL
npm run redeploy -- --branch hotfix  # deploy a non-default branch
npm run redeploy -- --force-dirty    # carry uncommitted edits into the build
```

If you'd rather run things manually, the equivalent four commands are:

```bash
git pull
npm ci
npm run build
sudo systemctl restart shopping-list
# then to apply any new migrations:
npx --no -- supabase migration up
```

## Lock down Supabase

`supabase start` exposes these ports on **all** interfaces by default,
which is fine on localhost but a footgun on a public server:

| Port  | What                       |
| ----- | -------------------------- |
| 54321 | Supabase API (PostgREST)   |
| 54322 | Postgres                   |
| 54323 | Supabase Studio (DB GUI)   |
| 54324 | Inbucket (mail trap)       |

Block them at the firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'    # 80 + 443
sudo ufw deny 54320:54330/tcp
sudo ufw enable
```

The BFF talks to Supabase over `127.0.0.1`, so blocking external access
costs nothing.

If you need to reach Studio remotely, use SSH port-forwarding:

```bash
ssh -L 54323:localhost:54323 you@your-server
# then http://localhost:54323 in your local browser
```

## Troubleshooting

```bash
systemctl status shopping-list
systemctl status shopping-list-supabase
journalctl -u shopping-list -n 200 --no-pager
journalctl -u shopping-list-supabase -n 200 --no-pager

# Is the BFF actually listening?
ss -tlnp | grep ':4000'

# Is Supabase healthy?
cd /srv/shopping-list-v3 && npx --no -- supabase status

# nginx config syntax + active sites
sudo nginx -t
sudo nginx -T | head -n 50
```

Common gotchas:

- **BFF can't reach Supabase on boot** → the supabase unit is `oneshot` so
  systemd thinks it's "done" the moment `supabase start` returns; if the
  containers are still starting, the BFF will retry the health check on
  its own (`Restart=on-failure`). If it loops forever, increase
  `TimeoutStartSec` in `shopping-list-supabase.service`.
- **502 Bad Gateway from nginx** → `journalctl -u shopping-list` and look
  for "Missing required env var" or a port conflict; remember `.env` is
  loaded via `EnvironmentFile=` so any change there needs a
  `systemctl restart shopping-list`.
- **PWA install fails on phone** → service workers require HTTPS. Make
  sure certbot succeeded and you're hitting `https://`, not `http://`.
