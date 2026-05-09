#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# shopping-list-v3 — production redeploy
#
# Pulls the latest code, reinstalls deps, rebuilds server + client, and
# bounces the BFF service. Designed to be safe to run unattended:
#
#   - never touches `.env`
#   - never touches the Supabase Docker volume (your data lives there)
#   - never restarts the Supabase systemd unit on a code-only deploy
#   - refuses to run as root (preserves file ownership)
#   - refuses to deploy on top of a dirty working tree unless --force-dirty
#
# Usage:
#   sudo systemctl restart shopping-list   # one-line manual restart, OR:
#   ./scripts/redeploy.sh                  # full pull → install → build → restart
#
# Flags:
#   --no-build       skip `npm ci` + `npm run build` (just bounces the BFF;
#                    use after a config-only change or for emergency restarts)
#   --no-pull        skip `git fetch && git pull` (deploy whatever is on disk)
#   --migrate        also run `supabase migration up` (only when migrations
#                    have actually changed; safe to omit otherwise)
#   --branch <name>  switch to <name> before pulling (default: current branch)
#   --force-dirty    proceed even if the working tree is dirty (your edits
#                    will be carried into the build — usually not what you
#                    want on prod)
#   -h, --help       print this help.
#
# Exposed via `npm run redeploy`.
# -----------------------------------------------------------------------------

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- options -----------------------------------------------------------------

DO_PULL=1
DO_BUILD=1
DO_MIGRATE=0
FORCE_DIRTY=0
BRANCH=""

while [ $# -gt 0 ]; do
  case "$1" in
    --no-pull)     DO_PULL=0 ;;
    --no-build)    DO_BUILD=0 ;;
    --migrate)     DO_MIGRATE=1 ;;
    --force-dirty) FORCE_DIRTY=1 ;;
    --branch)
      [ $# -ge 2 ] || { echo "--branch requires an argument" >&2; exit 2; }
      BRANCH="$2"
      shift
      ;;
    -h|--help|help)
      sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown flag: $1 (try --help)" >&2
      exit 2
      ;;
  esac
  shift
done

# --- helpers -----------------------------------------------------------------

c_reset=$'\033[0m'
c_dim=$'\033[2m'
c_green=$'\033[32m'
c_red=$'\033[31m'
c_yellow=$'\033[33m'
c_cyan=$'\033[36m'

step() { printf "%s→%s %s\n" "$c_cyan"   "$c_reset" "$1"; }
ok()   { printf "%s✓%s %s\n" "$c_green"  "$c_reset" "$1"; }
warn() { printf "%s!%s %s\n" "$c_yellow" "$c_reset" "$1"; }
die()  { printf "%s✗%s %s\n" "$c_red"    "$c_reset" "$1" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing command: $1"
}

env_get() {
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

# --- safety guards -----------------------------------------------------------

if [ "$(id -u)" = "0" ]; then
  die "don't run as root — this would chown your repo to root and confuse systemd. Run as the deploy user; the script uses sudo only where needed."
fi

require_cmd git
[ -d .git ] || die "not a git checkout (no .git here at $ROOT)"

# --- show current state ------------------------------------------------------

CUR_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")"
CUR_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo "?")"
TARGET_BRANCH="${BRANCH:-$CUR_BRANCH}"

printf "%sredeploy%s  branch=%s commit=%s install=%s\n" \
  "$c_dim" "$c_reset" "$TARGET_BRANCH" "$CUR_COMMIT" "$ROOT"

# --- pull --------------------------------------------------------------------

if [ "$DO_PULL" = "1" ]; then
  if ! git diff --quiet --ignore-submodules HEAD -- 2>/dev/null \
     || ! git diff --cached --quiet --ignore-submodules HEAD -- 2>/dev/null; then
    if [ "$FORCE_DIRTY" = "1" ]; then
      warn "working tree is dirty — proceeding anyway (--force-dirty)"
    else
      git status --short
      die "working tree has uncommitted changes. Commit or stash them, or rerun with --force-dirty."
    fi
  fi

  if [ -n "$BRANCH" ] && [ "$BRANCH" != "$CUR_BRANCH" ]; then
    step "switching to branch $BRANCH"
    git fetch --quiet origin "$BRANCH"
    git checkout "$BRANCH"
  fi

  step "git fetch + pull --ff-only"
  git fetch --quiet --prune
  git pull --ff-only

  NEW_COMMIT="$(git rev-parse --short HEAD)"
  if [ "$NEW_COMMIT" = "$CUR_COMMIT" ]; then
    ok "already at $NEW_COMMIT — nothing new to pull"
  else
    ok "$CUR_COMMIT → $NEW_COMMIT"
    # One-line shortlog so you can eyeball what changed.
    git --no-pager log --oneline "$CUR_COMMIT..$NEW_COMMIT" | sed 's/^/  /' | head -n 20
  fi
else
  step "skipping git pull (--no-pull)"
fi

# --- install + build ---------------------------------------------------------

if [ "$DO_BUILD" = "1" ]; then
  require_cmd npm
  step "npm ci (reproducible install from lockfile)"
  npm ci

  step "npm run build (server + client)"
  # vite-plugin-pwa occasionally chokes on a stale dep cache after a Node
  # upgrade — clearing it is cheap and avoids a confusing `terser` worker
  # crash on the next build.
  rm -rf client/node_modules/.vite 2>/dev/null || true
  npm run build
else
  step "skipping install + build (--no-build)"
fi

# --- migrations (opt-in) -----------------------------------------------------

if [ "$DO_MIGRATE" = "1" ]; then
  require_cmd npx
  step "applying Supabase migrations (--migrate)"
  # `migration up` is idempotent: it only runs files that haven't been
  # applied to this database yet. Safe even if there's nothing new.
  npx --no -- supabase migration up
fi

# --- restart the BFF only ----------------------------------------------------
#
# Two supported supervisors:
#   1. systemd unit `shopping-list` (the recommended setup, see deploy/)
#   2. nohup-supervised process started by scripts/prod.sh
# We probe for systemd first; that's the prod path. Either way we never
# touch the Supabase stack — its data is in a Docker volume and stopping
# it is unnecessary for a code-only redeploy.

restart_bff() {
  if command -v systemctl >/dev/null 2>&1 \
     && systemctl list-unit-files shopping-list.service >/dev/null 2>&1; then
    step "restarting shopping-list.service via systemd"
    sudo systemctl restart shopping-list.service
    return 0
  fi

  if [ -x scripts/prod.sh ]; then
    step "restarting BFF via scripts/prod.sh restart"
    scripts/prod.sh restart
    return 0
  fi

  die "no shopping-list systemd unit and no scripts/prod.sh — don't know how to restart the BFF on this host."
}

restart_bff

# --- health check ------------------------------------------------------------

PORT="$(env_get PORT)"
PORT="${PORT:-4000}"
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"

step "waiting for $HEALTH_URL"

if ! command -v curl >/dev/null 2>&1; then
  warn "curl not installed; skipping health probe."
else
  # Up to ~30s of retries — covers cold-start container boot and the
  # supabase reachability retry loop in src/lib/supabase.ts.
  for i in $(seq 1 30); do
    if body="$(curl -fsS --max-time 2 "$HEALTH_URL" 2>/dev/null)"; then
      ok "BFF healthy: $body"
      break
    fi
    sleep 1
    if [ "$i" = "30" ]; then
      warn "BFF didn't respond on $HEALTH_URL within 30s"
      if command -v systemctl >/dev/null 2>&1; then
        echo "--- last 30 lines of journalctl -u shopping-list ---" >&2
        sudo journalctl -u shopping-list -n 30 --no-pager || true
      fi
      die "redeploy finished but the service isn't healthy — check logs above."
    fi
  done
fi

ok "redeploy complete"
printf "  %sjournalctl -u shopping-list -f%s   to follow logs\n" "$c_dim" "$c_reset"
