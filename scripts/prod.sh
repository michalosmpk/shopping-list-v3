#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# shopping-list-v3 — production helper
#
# Single-host deployment for the Express BFF + built Vite SPA, with the local
# Supabase stack running alongside (Docker required). Idempotent — safe to
# re-run; only does work that's needed.
#
#   ./scripts/prod.sh start     # build & boot everything in the background
#   ./scripts/prod.sh stop      # stop the BFF (Supabase keeps running)
#   ./scripts/prod.sh restart   # stop + start
#   ./scripts/prod.sh status    # show what's up
#   ./scripts/prod.sh logs      # tail -f the BFF log
#
# Exposed via the root package.json as `npm run prod`, `npm run prod:stop`, ...
# -----------------------------------------------------------------------------

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LOG_DIR="$ROOT/logs"
LOG_FILE="$LOG_DIR/server.log"
PID_FILE="$LOG_DIR/server.pid"

mkdir -p "$LOG_DIR"

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

is_running() {
  [ -f "$PID_FILE" ] || return 1
  local pid
  pid="$(cat "$PID_FILE")"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
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
  if [ ! -f .env ]; then
    : > .env
  fi
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

random_secret() {
  # 48-byte url-safe random string. Prefers openssl, falls back to /dev/urandom.
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 48 | tr -d '\n=' | tr '/+' '_-'
  else
    LC_ALL=C tr -dc 'A-Za-z0-9_-' </dev/urandom | head -c 64
  fi
}

# --- supabase keys -----------------------------------------------------------

# Pulls the API URL + keys printed by `supabase status -o env` and writes them
# into .env (preserving everything else). First run also generates a real
# JWT_SECRET if the placeholder is still in place.
sync_env() {
  step "syncing .env from Supabase"

  if [ ! -f .env ]; then
    if [ -f .env.example ]; then
      cp .env.example .env
      ok "created .env from .env.example"
    else
      : > .env
    fi
  fi

  # supabase status emits KEY=VALUE pairs we can parse safely.
  local status_out
  if ! status_out="$(npx --no -- supabase status -o env 2>/dev/null)"; then
    die "supabase isn't running yet (run 'npm run prod:start' or 'supabase start')"
  fi

  local api_url anon service
  api_url="$(printf "%s\n" "$status_out" | awk -F= '$1=="API_URL"        {gsub(/"/,"",$2); print $2}')"
  anon="$(   printf "%s\n" "$status_out" | awk -F= '$1=="ANON_KEY"       {gsub(/"/,"",$2); print $2}')"
  service="$(printf "%s\n" "$status_out" | awk -F= '$1=="SERVICE_ROLE_KEY"{gsub(/"/,"",$2); print $2}')"

  [ -n "$api_url" ] && env_set SUPABASE_URL              "$api_url"
  [ -n "$anon"    ] && env_set SUPABASE_ANON_KEY         "$anon"
  [ -n "$service" ] && env_set SUPABASE_SERVICE_ROLE_KEY "$service"

  # First-run secret hygiene: replace the placeholder JWT_SECRET so guest +
  # admin-elevated tokens are actually unguessable.
  local jwt
  jwt="$(env_get JWT_SECRET)"
  if [ -z "$jwt" ] || [ "$jwt" = "change-me-to-a-long-random-string" ]; then
    env_set JWT_SECRET "$(random_secret)"
    ok "generated random JWT_SECRET"
  fi

  # NODE_ENV=production gates the SPA cache headers and silences req-logging.
  env_set NODE_ENV production

  # Default CORS to same-origin in prod (the BFF serves the SPA itself).
  if [ -z "$(env_get CLIENT_ORIGIN)" ]; then
    env_set CLIENT_ORIGIN "*"
  fi
}

# --- subcommands -------------------------------------------------------------

cmd_start() {
  require_cmd node
  require_cmd npm
  require_cmd docker

  if [ ! -d node_modules ]; then
    step "installing dependencies"
    npm install
  fi

  step "starting Supabase stack (idempotent)"
  if ! npx --no -- supabase status >/dev/null 2>&1; then
    npx --no -- supabase start
  else
    ok "supabase already running"
  fi

  sync_env

  step "building server + client"
  npm run build

  if is_running; then
    ok "BFF already running (pid $(cat "$PID_FILE"))"
  else
    step "starting BFF in the background"
    # `setsid` would be nice for full session detach, but it's Linux-only;
    # nohup + disown works on macOS and Linux.
    nohup node server/dist/index.js >>"$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    disown || true
    sleep 1
    if ! is_running; then
      warn "BFF exited within 1s; tail of $LOG_FILE:"
      tail -n 40 "$LOG_FILE" || true
      die "BFF failed to start"
    fi
  fi

  local port
  port="$(env_get PORT)"
  port="${port:-4000}"
  ok  "shopping-list-v3 is up"
  printf "  %sapp%s     http://localhost:%s\n"      "$c_dim" "$c_reset" "$port"
  printf "  %sapi%s     http://localhost:%s/api\n"  "$c_dim" "$c_reset" "$port"
  printf "  %slogs%s    npm run prod:logs\n"        "$c_dim" "$c_reset"
  printf "  %sstop%s    npm run prod:stop\n"        "$c_dim" "$c_reset"
}

cmd_stop() {
  if is_running; then
    local pid
    pid="$(cat "$PID_FILE")"
    kill "$pid" 2>/dev/null || true
    # Give the process up to 5s to exit gracefully, then SIGKILL.
    for _ in 1 2 3 4 5; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
    ok "BFF stopped"
  else
    warn "BFF was not running"
    rm -f "$PID_FILE"
  fi
  printf "  %ssupabase keeps running.%s use 'npm run supabase:stop' to stop it too.\n" \
    "$c_dim" "$c_reset"
}

cmd_restart() {
  cmd_stop || true
  cmd_start
}

cmd_status() {
  if is_running; then
    ok "BFF running (pid $(cat "$PID_FILE"))"
  else
    warn "BFF not running"
  fi
  if npx --no -- supabase status >/dev/null 2>&1; then
    ok "supabase running"
    npx --no -- supabase status 2>/dev/null | sed 's/^/  /'
  else
    warn "supabase not running"
  fi
}

cmd_logs() {
  [ -f "$LOG_FILE" ] || die "no log file yet at $LOG_FILE"
  exec tail -n 200 -f "$LOG_FILE"
}

usage() {
  cat <<USAGE
Usage: $(basename "$0") {start|stop|restart|status|logs}

  start     Boot Supabase (if needed), build, and run the BFF in the
            background. Idempotent — safe to re-run after pulling new code.
  stop      Stop the BFF. Supabase stays up.
  restart   stop + start.
  status    Show BFF + Supabase status.
  logs      Tail the BFF log file.
USAGE
}

case "${1:-}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_restart ;;
  status)  cmd_status ;;
  logs)    cmd_logs ;;
  ""|-h|--help|help) usage ;;
  *)       usage; exit 2 ;;
esac
