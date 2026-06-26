#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# shopping-list-v3 — development launcher
#
# One command to go from a cold checkout to a running dev environment:
#   - make sure Docker is actually up (OrbStack / Docker Desktop)
#   - install deps if node_modules is missing
#   - start the local Supabase stack (idempotent)
#   - refresh the Supabase keys in .env
#   - run Vite (:5173) + Express (:4000) in the foreground via `npm run dev`
#
# Foreground on purpose: dev wants live HMR + server logs streaming. Ctrl-C
# stops Vite + Express; Supabase keeps running (stop it with
# `npm run supabase:stop`).
#
# Exposed via the root package.json as `npm run up`.
# -----------------------------------------------------------------------------

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- helpers -----------------------------------------------------------------

c_reset=$'\033[0m'
c_dim=$'\033[2m'
c_green=$'\033[32m'
c_red=$'\033[31m'
c_yellow=$'\033[33m'
c_cyan=$'\033[36m'

step() { printf "%s→%s %s\n" "$c_cyan" "$c_reset" "$1"; }
ok()   { printf "%s✓%s %s\n" "$c_green" "$c_reset" "$1"; }
warn() { printf "%s!%s %s\n" "$c_yellow" "$c_reset" "$1"; }
die()  { printf "%s✗%s %s\n" "$c_red" "$c_reset" "$1" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing command: $1"
}

env_get() {
  # env_get KEY → value-or-empty (no shell interpretation, no quotes)
  [ -f .env ] || return 0
  awk -F= -v k="$1" '
    /^[[:space:]]*#/ { next }
    NF < 2          { next }
    $1 == k {
      sub(/^[^=]*=/, "")
      gsub(/^"|"$/, "")
      print
      exit
    }' .env
}

env_set() {
  # env_set KEY VALUE — replace existing line or append
  local key="$1" val="$2"
  [ -f .env ] || : > .env
  if grep -qE "^${key}=" .env 2>/dev/null; then
    local tmp
    tmp="$(mktemp)"
    awk -F= -v k="$key" -v v="$val" '
      BEGIN { done = 0 }
      $1 == k && !done { print k"="v; done = 1; next }
      { print }
      END { if (!done) print k"="v }
    ' .env > "$tmp" && mv "$tmp" .env
  else
    printf "%s=%s\n" "$key" "$val" >> .env
  fi
}

# --- docker ------------------------------------------------------------------

# Supabase needs a running Docker daemon. A cold OrbStack/Docker Desktop is the
# single most common reason `supabase start` (and therefore login) fails, so we
# try to bring it up and wait, rather than failing with a cryptic error.
ensure_docker() {
  require_cmd docker
  if docker info >/dev/null 2>&1; then
    ok "Docker is running"
    return
  fi

  step "Docker isn't running — trying to start it"
  case "$(uname -s)" in
    Darwin)
      if [ -d "/Applications/OrbStack.app" ] || [ -d "$HOME/Applications/OrbStack.app" ]; then
        open -a OrbStack 2>/dev/null || true
      elif [ -d "/Applications/Docker.app" ]; then
        open -a Docker 2>/dev/null || true
      else
        die "no Docker daemon and couldn't find OrbStack/Docker Desktop — start Docker manually"
      fi
      ;;
    Linux)
      # Best effort; may need sudo. Don't hard-fail if we can't.
      systemctl start docker 2>/dev/null || sudo systemctl start docker 2>/dev/null || true
      ;;
    *)
      die "unsupported OS for auto-starting Docker — start it manually"
      ;;
  esac

  step "waiting for Docker to come up"
  for _ in $(seq 1 60); do
    if docker info >/dev/null 2>&1; then
      ok "Docker is running"
      return
    fi
    sleep 1
  done
  die "Docker didn't become ready in 60s — start it manually and re-run"
}

# --- supabase ----------------------------------------------------------------

# Wait until `supabase status` reports a fully-ready stack. Returns 0 on ready.
wait_for_supabase() {
  for _ in $(seq 1 "${1:-60}"); do
    if npx --no -- supabase status >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

ensure_supabase() {
  step "starting Supabase stack (idempotent)"

  if npx --no -- supabase status >/dev/null 2>&1; then
    ok "supabase already running"
    return
  fi

  # `supabase status` can fail for two very different reasons: the stack isn't
  # started at all, or it's started but a container is still booting (e.g.
  # right after Docker itself came up — "container is not ready: starting").
  # `supabase start` errors out in that second case ("already running"), so we
  # don't treat a failed start as fatal — we just wait for readiness either way.
  if ! npx --no -- supabase start >/dev/null 2>&1; then
    warn "supabase is still coming up — waiting for it to become ready"
  fi

  if wait_for_supabase 60; then
    ok "supabase ready"
  else
    die "supabase didn't become ready in time — run 'npx supabase status' to diagnose"
  fi
}

# Refresh the local Supabase API URL + keys in .env. The local stack uses fixed
# demo keys, but syncing keeps .env correct if the stack is ever reconfigured.
sync_env() {
  step "syncing .env from Supabase"
  if [ ! -f .env ] && [ -f .env.example ]; then
    cp .env.example .env
    ok "created .env from .env.example"
  fi

  local status_out
  status_out="$(npx --no -- supabase status -o env 2>/dev/null)" || {
    warn "couldn't read supabase status; leaving .env as-is"
    return 0
  }

  local api_url anon service
  api_url="$(printf "%s\n" "$status_out" | awk -F= '$1=="API_URL"          {gsub(/"/,"",$2); print $2}')"
  anon="$(   printf "%s\n" "$status_out" | awk -F= '$1=="ANON_KEY"         {gsub(/"/,"",$2); print $2}')"
  service="$(printf "%s\n" "$status_out" | awk -F= '$1=="SERVICE_ROLE_KEY" {gsub(/"/,"",$2); print $2}')"

  [ -n "$api_url" ] && env_set SUPABASE_URL              "$api_url"
  [ -n "$anon"    ] && env_set SUPABASE_ANON_KEY         "$anon"
  [ -n "$service" ] && env_set SUPABASE_SERVICE_ROLE_KEY "$service"
  ok ".env in sync"
}

# --- main --------------------------------------------------------------------

require_cmd node
require_cmd npm

ensure_docker

if [ ! -d node_modules ]; then
  step "installing dependencies"
  npm install
fi

ensure_supabase
sync_env

admin_name="$(env_get ADMIN_BOOTSTRAP_NAME)"
admin_pass="$(env_get ADMIN_BOOTSTRAP_PASSWORD)"

ok "dev environment ready"
printf "  %sapp%s        http://localhost:5173\n"        "$c_dim" "$c_reset"
printf "  %sapi%s        http://localhost:4000/api\n"    "$c_dim" "$c_reset"
printf "  %sstudio%s     http://localhost:54323\n"       "$c_dim" "$c_reset"
if [ -n "$admin_name" ] && [ -n "$admin_pass" ]; then
  printf "  %sadmin%s      %s / %s %s(only created on first cold boot)%s\n" \
    "$c_dim" "$c_reset" "$admin_name" "$admin_pass" "$c_dim" "$c_reset"
fi
printf "  %sstop%s       Ctrl-C (Supabase keeps running; 'npm run supabase:stop' to halt it)\n" \
  "$c_dim" "$c_reset"
echo

step "starting Vite + Express (npm run dev)"
exec npm run dev
