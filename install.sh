#!/usr/bin/env bash
# Installs Queue Pilot on this machine with Docker: checks Docker Compose 2, writes .env with every secret generated
# here (nothing to copy by hand), and starts the app, Postgres, the scheduler, nightly database backups, and, when you
# give a domain, automatic HTTPS. Run it from this folder: ./install.sh
# Safe to run again: an existing .env is kept, so secrets and data never change underneath you.
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '%s\n' "$*"; }
fail() { printf 'Stopped: %s\n' "$*" >&2; exit 1; }

docker compose version >/dev/null 2>&1 || fail "Docker Compose 2 is not installed. Install Docker from https://docs.docker.com/engine/install/ and run this again."
[ "$(docker compose version --short | cut -d. -f1 | tr -dc 0-9)" -ge 2 ] || fail "Docker Compose is older than version 2. Update Docker and run this again."
command -v openssl >/dev/null 2>&1 || fail "openssl is needed to make the secrets. Install it and run this again."

if [ -f .env ]; then
  say "Keeping the existing .env (its secrets and your data stay as they are)."
else
  domain="${QP_DOMAIN:-}"
  if [ -z "$domain" ] && [ -t 0 ]; then
    read -r -p "Your domain for Queue Pilot, e.g. qp.example.com (leave empty to try it on this computer): " domain
  fi
  domain="$(printf '%s' "$domain" | sed -E 's#^https?://##; s#/.*$##' | tr -d '[:space:]')"
  # Port 3000 is only ever on this machine: with a domain the HTTPS proxy is the way in; without one it is a trial on
  # this computer. Serving plain HTTP to the internet takes a deliberate QP_BIND=0.0.0.0 in .env.
  if [ -n "$domain" ]; then site="https://$domain"; hops=1; else site="http://localhost:3000"; hops=""; fi
  bind=127.0.0.1
  umask 077
  cat > .env <<EOF
# Written by install.sh on $(date -u +%F). Every secret below was generated on this machine.
SESSION_SECRET=$(openssl rand -hex 32)
SETTINGS_KEY=$(openssl rand -hex 32)
ADMIN_SETUP_CODE=$(openssl rand -hex 16)
CRON_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 24)
BUFFER_REDIRECT_URI=$site/api/auth/callback/buffer
# Your Buffer app's client ID and secret: here, or later in /admin.
BUFFER_CLIENT_ID=
BUFFER_CLIENT_SECRET=
TRUSTED_PROXY_HOP_COUNT=$hops
QP_DOMAIN=$domain
QP_BIND=$bind
EOF
  say "Wrote .env with new secrets."
fi

# shellcheck disable=SC1091
domain="$(grep -E '^QP_DOMAIN=' .env | cut -d= -f2- || true)"
profiles=(--profile backup)
[ -n "$domain" ] && profiles+=(--profile https)
docker compose "${profiles[@]}" up -d --build

site="http://localhost:3000"; [ -n "$domain" ] && site="https://$domain"
code="$(grep -E '^ADMIN_SETUP_CODE=' .env | cut -d= -f2-)"
say ""
say "Queue Pilot is starting at $site"
say "1. Open $site/admin and claim it with this setup code: $code"
say "2. In /admin, add your Buffer app (Settings, API in Buffer; its redirect URI is $site/api/auth/callback/buffer)."
[ -n "$domain" ] && say "HTTPS: point $domain's DNS at this server; the certificate is issued on the first visit."
say "Backups: one database dump a night, kept 14 days, in ./backups."
