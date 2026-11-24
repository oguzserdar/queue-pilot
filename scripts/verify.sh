#!/bin/sh
# One command for every local check, in order, at low priority. Refuses to start while the Mac is busy (1-minute load
# at or above QP_MAX_LOAD, default 24), so a test run never competes with other work for the machine.
set -e
max="${QP_MAX_LOAD:-24}"
load=$(sysctl -n vm.loadavg 2>/dev/null | awk '{print $2}' || uptime | awk -F'load averages?: ' '{print $2}' | cut -d' ' -f1)
load=$(echo "$load" | tr ',' '.')
if awk "BEGIN{exit !($load >= $max)}"; then echo "Load is $load (limit $max). Try again when the machine is quieter."; exit 2; fi
nice -n 10 pnpm typecheck
nice -n 10 node scripts/check-lint.mjs
nice -n 10 pnpm check:gates
nice -n 10 pnpm test
