#!/usr/bin/env bash
# Isolation E2E gate for libra.us_adult.catalogue.observe@1 (#40 schema reject fix).
# Runs against a local Node checkout with temp catalogue mounts inside the tests —
# never points at NAS / 192.168.12.230.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== US Adult catalogue observe isolation E2E =="
echo "cwd=$ROOT"
echo "node=$(node -v)"

# 1) Production schema + Host volume + EventRuntime + catalogue_candidate gate
node --test \
  test/helix-architecture/us-adult-catalogue-observe-input-contract.test.js \
  test/helix-architecture/us-adult-catalogue-observe-isolation-e2e.test.js \
  test/helix-architecture/us-adult-catalogue-host-wiring.test.js

# 2) Happy-path EventRuntime / Capability / coordinator (exclude incomplete recovery cases)
node --test \
  --test-name-pattern 'a real admitted Observation Work runs its immutable Plan|reviewed catalogue Capability plans nominal ports|a complete qualified initial Observation' \
  test/helix-architecture/qualification/us-adult-catalogue-event-runtime.test.js \
  test/helix-architecture/qualification/us-adult-catalogue-observation.test.js \
  test/helix-architecture/us-adult-catalogue-coordinator.test.js

echo "== PASS: observe isolation E2E gate =="
