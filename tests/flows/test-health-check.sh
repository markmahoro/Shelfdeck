#!/usr/bin/env bash
# test-health-check.sh — Health Check flow (Tier 3, CI-safe)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../common.sh"

SV="${SERVICE_URL:-http://127.0.0.1:18080}"
echo "# Health Check Flow"
echo "# Service: ${SV}"

# ── Case 1: GET /v1/health basic check ─────────────────────────────────

r=$(curl -fsS "${SV}/v1/health" 2>/dev/null)
status=$(echo "$r" | json_field 'j.status')
assert_contains "health status is green/yellow/red" "green yellow red" "$status"
echo "# Health status: ${status}"

timestamp=$(echo "$r" | json_field 'j.timestamp')
if [ -n "$timestamp" ] && [ "$timestamp" != "null" ]; then
  ok "health response has timestamp"
else
  not_ok "health response has timestamp"
fi

# ── Case 2: GET /v1/admin/health has all checks ────────────────────────

r=$(curl -fsS "${SV}/v1/admin/health" 2>/dev/null)
echo "$r" | json_field 'j.checks' | grep -q . >/dev/null 2>&1
if [ $? -eq 0 ]; then
  ok "admin health has checks object"
else
  not_ok "admin health has checks object"
fi

for check in scheduler emby transcode upgrade; do
  check_val=$(echo "$r" | json_field "j.checks.${check}.status")
  if [ -n "$check_val" ] && [ "$check_val" != "null" ]; then
    ok "admin health check: ${check}=${check_val}"
  else
    not_ok "admin health check: ${check} missing"
  fi
done

# ── Case 3: Health endpoint responds fast ──────────────────────────────

start=$(date +%s)
curl -fsS "${SV}/v1/health" 2>/dev/null >/dev/null
end=$(date +%s)
elapsed=$((end - start))
if [ "$elapsed" -lt 2 ]; then
  ok "health responds fast (${elapsed}s)"
else
  not_ok "health responds fast (${elapsed}s)"
fi

done_testing
