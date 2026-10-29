#!/usr/bin/env bash
# Layout gate: every screen must fit the window at the owner's narrow size (671x905) and at 1440x900.
# Starts a dev server on :4417, checks document scrollWidth on each route, stops the server, exits 1 on any overflow.
# Run before deploying a new screen or navigation item: bash scripts/check-overflow.sh
set -u
cd "$(dirname "$0")/.."
ROUTES="/ /week /delivery /playbook /ideas /voice /sources /connect /settings /sign-in /admin /embed/week /dev/sync-states?state=failed /dev/sync-states?state=limited /dev/sources-live /dev/sources-live?connected=1 /dev/live-states?screen=ideas /dev/live-states?screen=voice /dev/live-states?screen=settings /nope-page"
load=$(uptime | sed 's/.*load averages*: *//; s/[, ].*//')
if [ "${load%.*}" -ge 24 ]; then echo "skipped: load $load"; exit 2; fi
(pnpm exec next dev -p 4417 > /tmp/qp-overflow.log 2>&1 &)
for i in $(seq 1 90); do [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4417/)" = "200" ] && break; sleep 2; done
fail=0
for size in "671 905" "1440 900"; do
  w=${size% *}
  agent-browser --session qp open http://localhost:4417/ >/dev/null 2>&1
  agent-browser --session qp set viewport $size >/dev/null 2>&1
  for r in $ROUTES; do
    agent-browser --session qp open "http://localhost:4417$r" >/dev/null 2>&1
    sleep 2
    got=$(agent-browser --session qp eval 'document.documentElement.scrollWidth' 2>&1 | tail -1 | tr -dc '0-9')
    if [ "${got:-0}" -gt "$w" ]; then echo "OVERFLOW $r at $w: $got"; fail=1; else echo "ok $r at $w"; fi
  done
done
agent-browser --session qp close >/dev/null 2>&1
kill $(lsof -ti tcp:4417 -sTCP:LISTEN) 2>/dev/null
sleep 1
# The dev cache regrows to ~0.5 GB per run on a nearly full disk; it rebuilds itself next time.
rm -rf ./.next /tmp/qp-overflow.log
exit $fail
