#!/usr/bin/env bash
# runner.sh — ShelfDeck E2E test runner
#
# Usage:
#   tests/runner.sh <flow-list> [env-file]
#
#   flow-list: comma-separated flow names, or "all"
#   env-file:   path to env file (default: tests/env/local-win.env)
#
# Examples:
#   tests/runner.sh health-check,config-roundtrip
#   tests/runner.sh all tests/env/docker-fn.env
#   tests/runner.sh upgrade-flow tests/env/local-win.env

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── parse arguments ─────────────────────────────────────────────────────

FLOWS="${1:-health-check}"
ENV_FILE="${2:-}"

# Load env file
if [ -n "$ENV_FILE" ]; then
  if [ -f "$ENV_FILE" ]; then
    set -a; . "$ENV_FILE"; set +a
  elif [ -f "${SCRIPT_DIR}/env/${ENV_FILE}" ]; then
    set -a; . "${SCRIPT_DIR}/env/${ENV_FILE}"; set +a
  fi
fi

SERVICE_URL="${SERVICE_URL:-http://127.0.0.1:18080}"
export SERVICE_URL
export MP_URL="${MP_URL:-}"
export MP_KEY="${MP_KEY:-}"
export TEST_SUBLIB="${TEST_SUBLIB:-}"
export EMBY_URL="${EMBY_URL:-}"
export EMBY_KEY="${EMBY_KEY:-}"

# ── health check ────────────────────────────────────────────────────────

wait_for_health_check() {
  local attempts=0
  while [ $attempts -lt 20 ]; do
    if curl -fsS --connect-timeout 3 --max-time 5 "${SERVICE_URL}/v1/health" >/dev/null 2>&1; then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 1
  done
  return 1
}

# ── flow mapping ────────────────────────────────────────────────────────

AVAILABLE_FLOWS="health-check config-roundtrip task-crud delete-flow transcode-flow upgrade-flow media-library-flow"

run_flow() {
  local name="$1"
  local script="${SCRIPT_DIR}/flows/test-${name}.sh"
  if [ ! -f "$script" ]; then
    echo "Bail out! Flow script not found: ${script}"
    return 1
  fi
  echo ""
  echo "# === FLOW: ${name} ==="
  echo "# Target: ${SERVICE_URL}"
  set +e
  bash "$script"
  local rc=$?
  set -e
  return $rc
}

# ── main ────────────────────────────────────────────────────────────────

echo "# ShelfDeck E2E Test Runner"
echo "# Service: ${SERVICE_URL}"
echo "#"

# Verify service is reachable
if ! wait_for_health_check; then
  echo "Bail out! Service not reachable at ${SERVICE_URL}"
  exit 1
fi
echo "# Service is healthy"
echo "#"

OVERALL_FAIL=0

if [ "$FLOWS" = "all" ]; then
  for f in $AVAILABLE_FLOWS; do
    run_flow "$f" || OVERALL_FAIL=$((OVERALL_FAIL + 1))
  done
else
  IFS=',' read -ra FLOW_ARR <<< "$FLOWS"
  for f in "${FLOW_ARR[@]}"; do
    f=$(echo "$f" | xargs)
    run_flow "$f" || OVERALL_FAIL=$((OVERALL_FAIL + 1))
  done
fi

echo ""
if [ "$OVERALL_FAIL" -gt 0 ]; then
  echo "# Runner: ${OVERALL_FAIL} flow(s) failed"
  exit 1
else
  echo "# Runner: all flows passed"
  exit 0
fi
