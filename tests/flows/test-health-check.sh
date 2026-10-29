#!/usr/bin/env bash
# test-health-check.sh — Health Check flow (Tier 3, CI-safe)
# Helix clean runtime: public GET /v1/health returns { status: "ok", generation, ... }.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../common.sh"

SV="${SERVICE_URL:-http://127.0.0.1:18080}"
echo "# Health Check Flow"
echo "# Service: ${SV}"

# ── Case 1: GET /v1/health basic check ─────────────────────────────────

r=$(curl -fsS "${SV}/v1/health" 2>/dev/null)
status=$(echo "$r" | json_field 'j.status')
# Helix clean uses "ok"; legacy green/yellow/red still accepted if present.
assert_contains "health status is ok (or legacy green/yellow/red)" "ok green yellow red" "$status"
echo "# Health status: ${status}"

generation=$(echo "$r" | json_field 'j.generation')
if [ -n "$generation" ] && [ "$generation" != "null" ]; then
  ok "health response has generation (${generation})"
else
  # Legacy health used timestamp instead of generation.
  timestamp=$(echo "$r" | json_field 'j.timestamp')
  if [ -n "$timestamp" ] && [ "$timestamp" != "null" ]; then
    ok "health response has timestamp (legacy shape)"
  else
    not_ok "health response has generation or timestamp"
  fi
fi

# ── Case 2: legacy /v1/admin/health is not part of Helix clean surface ─

code=$(curl -s -o /dev/null -w '%{http_code}' "${SV}/v1/admin/health" 2>/dev/null || true)
if [ "$code" = "404" ] || [ "$code" = "401" ] || [ "$code" = "000" ]; then
  ok "legacy admin health not required on Helix clean (http ${code})"
elif [ "$code" = "200" ]; then
  ok "admin health still present (legacy) http 200"
else
  not_ok "unexpected admin health http ${code}"
fi

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
