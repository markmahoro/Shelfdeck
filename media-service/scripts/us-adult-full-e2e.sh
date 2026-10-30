#!/usr/bin/env bash
# Full US Adult simulated gate checks (no NAS). Observe-isolation alone is not acceptance.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
node --test \
  test/helix-architecture/us-adult-formation-attention-western.test.js \
  test/helix-architecture/us-adult-actor-package.test.js \
  test/helix-architecture/us-adult-catalogue-registration-admission.test.js \
  test/helix-architecture/us-adult-catalogue-host-wiring.test.js
echo "us-adult-full-e2e: unit/host-wiring gate checks passed"
