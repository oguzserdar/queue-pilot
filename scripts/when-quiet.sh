#!/bin/sh
# Runs the given command at low priority only while the 1-minute load is under QP_MAX_LOAD (default 24); otherwise
# refuses with exit 2. Every test, lint or build run goes through this, so a busy machine is never loaded further.
max="${QP_MAX_LOAD:-24}"
load=$(sysctl -n vm.loadavg | awk '{print $2}' | tr ',' '.')
if awk "BEGIN{exit !($load >= $max)}"; then echo "Load is $load (limit $max). Not running: $*"; exit 2; fi
exec nice -n 10 "$@"
