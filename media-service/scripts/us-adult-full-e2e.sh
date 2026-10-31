#!/usr/bin/env bash
# Full US Adult simulated gate checks (no NAS). Observe-isolation alone is not acceptance.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
node --test \
  test/helix-architecture/us-adult-formation-attention-western.test.js \
  test/helix-architecture/us-adult-actor-package.test.js \
  test/helix-architecture/us-adult-catalogue-registration-admission.test.js \
  test/helix-architecture/us-adult-catalogue-host-wiring.test.js \
  test/helix-architecture/us-adult-full-e2e-recognition.test.js \
  test/helix-architecture/us-adult-catalogue-settlement-register.test.js \
  test/helix-architecture/us-adult-catalogue-registration.test.js \
  test/helix-architecture/us-adult-name-resolution.test.js || exit 1
echo "us-adult-full-e2e: name-first bind + recognition+shelfable gate checks passed"
